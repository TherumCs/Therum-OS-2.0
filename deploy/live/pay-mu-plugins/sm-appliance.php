<?php
/**
 * Sidemoney payment engine — surface control. Headless: no pages, no posts,
 * no theme chrome. Served ONLY on the carved WooPayments/Jetpack paths under
 * sidemoney.co (internal upstream); nothing here should say WordPress.
 */
remove_action( 'wp_head', 'wp_generator' );
add_filter( 'the_generator', '__return_empty_string' );
add_action( 'login_enqueue_scripts', function () {
	echo '<style>#login h1 a{background:none;text-indent:0;width:auto;height:auto;font:800 28px/1.2 -apple-system,sans-serif;color:#070707;}#login h1 a:after{content:"Sidemoney · Counter";}</style>';
} );
add_filter( 'login_headerurl', function () { return 'https://sidemoney.co'; } );
add_filter( 'login_headertext', function () { return 'Sidemoney'; } );
add_filter( 'login_title', function () { return 'Sign in · Sidemoney Counter'; } );
add_action( 'send_headers', function () { header( 'X-Robots-Tag: noindex, nofollow' ); } );

/**
 * ---------------------------------------------------------------------------
 * Charge bridge — Counter → engine.
 *
 * Counter (our Fastify/Next store) owns the cart, the customer and the order
 * of record in Postgres. The engine's only job on the write side is to mint a
 * WooPayments PaymentIntent against the live merchant account and hand back a
 * client_secret the browser confirms directly with Stripe. We create a thin
 * WC order purely so WCPay's own webhook has something to correlate to and so
 * the funds land against the merchant — it is a receipt stub, not the source
 * of truth.
 *
 * Flow:
 *   1. POST /wp-json/wc/v3/payments/sm/charge  (Basic auth, manage_woocommerce)
 *      → creates/reuses the stub WC order + an UNCONFIRMED intent, returns the
 *        client_secret + publishable key + account id.
 *   2. Browser confirms the intent with Stripe.js.
 *   3. Stripe → WP.com → carved /payments/webhook → WCPay runs
 *        $order->payment_complete(), firing 'woocommerce_payment_complete'.
 *   4. Our hook below signs a payload and POSTs it to Counter's internal
 *        receiver, which flips the Postgres order pending → processing.
 *
 * Nothing here confirms or captures a charge server-side; capture is
 * automatic once the browser confirms.
 *
 * FAILURES are deliberately NOT notified from here. A declined/abandoned
 * attempt leaves the Postgres order 'pending', which Counter's own stale-pending
 * sweep reclaims — and the shopper sees the decline inline from Stripe.js. An
 * engine 'failed' notifier was removed because a decline-then-retry-success on
 * one intent would drive the Counter order into the terminal 'failed' state and
 * then the succeeding charge could never advance to processing (money captured,
 * nothing shipped). Success is the only event we bridge.
 * ---------------------------------------------------------------------------
 */

add_action( 'rest_api_init', function () {
	register_rest_route( 'wc/v3', '/payments/sm/charge', array(
		'methods'             => 'POST',
		'permission_callback' => function () { return current_user_can( 'manage_woocommerce' ); },
		'callback'            => 'sm_appliance_charge',
	) );
} );

/**
 * Live publishable key + connected account id, fetched once. Reads the cached
 * account blob and falls back to the dedicated getters if its shape differs.
 *
 * @return array{publishable_key:string,account_id:string}
 */
function sm_appliance_account() {
	$pk         = '';
	$account_id = '';
	if ( class_exists( 'WC_Payments' ) ) {
		try {
			$svc  = WC_Payments::get_account_service();
			$data = (array) $svc->get_cached_account_data();
			if ( isset( $data['live_publishable_key'] ) ) {
				$pk = (string) $data['live_publishable_key'];
			}
			if ( isset( $data['account_id'] ) ) {
				$account_id = (string) $data['account_id'];
			}
			if ( '' === $pk && method_exists( $svc, 'get_publishable_key' ) ) {
				$pk = (string) $svc->get_publishable_key( false ); // false = live, not test.
			}
			if ( '' === $account_id && method_exists( $svc, 'get_stripe_account_id' ) ) {
				$account_id = (string) $svc->get_stripe_account_id();
			}
		} catch ( \Throwable $e ) {
			// Leave blank; the caller still returns the client_secret so the
			// browser can confirm — the keys are a convenience for the client.
		}
	}
	return array(
		'publishable_key' => $pk,
		'account_id'      => $account_id,
	);
}

/**
 * Set the stub order's single fee line to exactly the requested minor-unit
 * amount, clearing any prior fee lines first so a changed amount never stacks.
 *
 * @param WC_Order $o        Order.
 * @param int      $amount   Minor units (cents).
 * @param string   $currency Currency code.
 * @param string   $label    Fee line name.
 * @param array    $billing  Billing address.
 * @param array    $shipping Shipping address.
 * @param string   $email    Billing email.
 * @return void
 */
function sm_appliance_set_amount( $o, $amount, $currency, $label, $billing, $shipping, $email ) {
	foreach ( $o->get_items( 'fee' ) as $item_id => $item ) {
		$o->remove_item( $item_id );
	}
	$fee = new WC_Order_Item_Fee();
	$fee->set_name( $label );
	$fee->set_total( number_format( $amount / 100, 2, '.', '' ) );
	$fee->set_tax_status( 'none' ); // Keep the total exactly equal to amount for the parity assert.
	$o->add_item( $fee );
	$o->set_currency( strtoupper( $currency ) );
	if ( ! empty( $billing ) ) {
		$o->set_address( $billing, 'billing' );
	}
	if ( '' !== $email && '' === (string) $o->get_billing_email() ) {
		$o->set_billing_email( $email );
	}
	if ( ! empty( $shipping ) ) {
		$o->set_address( $shipping, 'shipping' );
	}
	$o->set_payment_method( 'woocommerce_payments' );
	$o->calculate_totals( false );
}

/**
 * Handler for POST /wp-json/wc/v3/payments/sm/charge.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function sm_appliance_charge( WP_REST_Request $request ) {
	try {
		$p = $request->get_json_params();
		if ( ! is_array( $p ) ) {
			$p = array();
		}

		$amount      = isset( $p['amount'] ) ? (int) $p['amount'] : 0;
		$currency    = ( isset( $p['currency'] ) && '' !== $p['currency'] ) ? (string) $p['currency'] : 'USD';
		$sm_order_id = isset( $p['sm_order_id'] ) ? (string) $p['sm_order_id'] : '';
		$sm_number   = isset( $p['sm_order_number'] ) ? (string) $p['sm_order_number'] : '';
		$email       = isset( $p['email'] ) ? sanitize_email( (string) $p['email'] ) : '';
		$methods     = ( isset( $p['methods'] ) && is_array( $p['methods'] ) && ! empty( $p['methods'] ) )
			? array_values( array_map( 'strval', $p['methods'] ) )
			: array( 'card' );
		$billing     = ( isset( $p['billing'] ) && is_array( $p['billing'] ) ) ? $p['billing'] : array();
		$shipping    = ( isset( $p['shipping'] ) && is_array( $p['shipping'] ) ) ? $p['shipping'] : array();
		$label       = 'Order ' . ( '' !== $sm_number ? $sm_number : $sm_order_id );

		if ( $amount < 1 ) {
			return new WP_Error( 'sm_charge_bad_amount', 'amount must be a positive integer of minor units', array( 'status' => 400 ) );
		}
		if ( '' === $sm_order_id ) {
			return new WP_Error( 'sm_charge_bad_order', 'sm_order_id is required', array( 'status' => 400 ) );
		}

		// --- Find an existing (non-cancelled) stub for this sm_order_id -------
		// Newest first, and cancelled stubs (a prior amount-parity refusal) are
		// excluded so a legitimate retry never grabs a dead order.
		$o        = null;
		$existing = wc_get_orders( array(
			'limit'      => 1,
			'orderby'    => 'date',
			'order'      => 'DESC',
			'status'     => array( 'pending', 'on-hold', 'processing', 'completed', 'failed' ),
			'meta_query' => array(
				array(
					'key'   => '_sm_order_id',
					'value' => $sm_order_id,
				),
			),
		) );
		if ( ! empty( $existing ) ) {
			$o = ( $existing[0] instanceof WC_Order ) ? $existing[0] : wc_get_order( $existing[0] );
		}

		// --- Idempotent replay --------------------------------------------
		// Reuse the stamped intent ONLY when it is still confirmable and its
		// amount still matches. A canceled/dead intent, or a changed amount,
		// falls through to refresh the intent on the SAME order — never hands
		// back a stale client_secret the browser can't confirm.
		if ( $o ) {
			$intent_id     = (string) $o->get_meta( '_intent_id' );
			$client_secret = (string) $o->get_meta( '_sm_client_secret' );
			if ( '' !== $intent_id && '' !== $client_secret ) {
				$reusable = true;
				if ( class_exists( '\WCPay\Core\Server\Request\Get_Intention' ) ) {
					try {
						$intent  = \WCPay\Core\Server\Request\Get_Intention::create( $intent_id )->send();
						$status  = (string) $intent->get_status();
						$iamount = method_exists( $intent, 'get_amount' ) ? (int) $intent->get_amount() : $amount;
						if ( 'canceled' === $status || $iamount !== $amount ) {
							$reusable = false;
						} else {
							$client_secret = (string) $intent->get_client_secret();
							$intent_id     = (string) $intent->get_id();
						}
					} catch ( \Throwable $e ) {
						// Can't verify live — assume the stored secret is still good.
					}
				}
				if ( $reusable ) {
					$acct = sm_appliance_account();
					return rest_ensure_response( array(
						'client_secret'     => $client_secret,
						'wc_order_id'       => $o->get_id(),
						'payment_intent_id' => $intent_id,
						'publishable_key'   => $acct['publishable_key'],
						'account_id'        => $acct['account_id'],
						'idempotent_replay' => true,
					) );
				}
			}
		}

		// --- Create the stub order if none exists -------------------------
		if ( ! $o ) {
			$o = wc_create_order();
			if ( is_wp_error( $o ) ) {
				return $o;
			}
			$o->update_meta_data( '_sm_order_id', $sm_order_id );
		}
		$o->update_meta_data( '_sm_order_number', $sm_number );
		sm_appliance_set_amount( $o, $amount, $currency, $label, $billing, $shipping, $email );
		$o->save();
		$wc_id = $o->get_id();

		// Amount parity: the WC order must total exactly what Counter asked to
		// charge, or we refuse rather than mint an intent for a wrong figure.
		if ( (int) round( $o->get_total() * 100 ) !== $amount ) {
			$o->update_status( 'cancelled', 'sm: amount parity mismatch — no intent created.' );
			return new WP_Error( 'amount_mismatch', 'computed order total does not match requested amount', array( 'status' => 400 ) );
		}

		// --- WCPay customer (REQUIRED, not optional) ----------------------
		// The intent MUST carry an explicit customer. In the REST context this
		// endpoint runs authenticated as the `sidemoney` WP user, who has no
		// WCPay customer — so if we leave the customer unset, Create_Intention
		// resolves that user's (empty) customer id and the charge dies with
		// "GET /v1/customers/" (empty id). We always create/resolve a real guest
		// customer instead. A billing email is required to create one, so fall
		// back to a per-order guest address when the caller sent none.
		if ( '' === (string) $o->get_billing_email() ) {
			$o->set_billing_email( '' !== $email ? $email : 'guest+' . $sm_order_id . '@sidemoney.co' );
			$o->save();
		}
		$customer_id = '';
		if ( class_exists( 'WC_Payments' ) ) {
			try {
				$cs = WC_Payments::get_customer_service();
				if ( method_exists( $cs, 'get_or_create_customer_id_from_order' ) ) {
					$customer_id = (string) $cs->get_or_create_customer_id_from_order( null, $o );
				} elseif ( method_exists( $cs, 'create_customer_for_user' ) ) {
					$first       = isset( $billing['first_name'] ) ? (string) $billing['first_name'] : '';
					$last        = isset( $billing['last_name'] ) ? (string) $billing['last_name'] : '';
					$customer_id = (string) $cs->create_customer_for_user( null, array(
						'name'  => trim( $first . ' ' . $last ),
						'email' => (string) $o->get_billing_email(),
					) );
				}
			} catch ( \Throwable $e ) {
				$customer_id = '';
			}
		}

		// --- Build the (unconfirmed) PaymentIntent ------------------------
		$r = \WCPay\Core\Server\Request\Create_Intention::create();
		$r->set_amount( $amount );
		$r->set_currency_code( strtolower( $currency ) );
		$r->set_payment_method_types( $methods );
		if ( '' !== $customer_id ) {
			$r->set_customer( $customer_id );
		}
		if ( ! empty( $shipping ) ) {
			$r->set_shipping( $shipping );
		}
		$r->set_capture_method( false ); // false = automatic capture (funds taken on browser confirm).
		$r->set_metadata( array(
			// 'order_id' is REQUIRED: WCPay's webhook correlates the intent back
			// to this WC order by this exact key.
			'order_id'     => (string) $wc_id,
			'sm_order_id'  => $sm_order_id,
			'order_number' => '' !== $sm_number ? $sm_number : (string) $wc_id,
		) );
		$intent = $r->send();

		// Stamp the order so the webhook (via '_intent_id') and any replay can
		// find their way home.
		$o->update_meta_data( '_intent_id', $intent->get_id() );
		$o->update_meta_data( '_sm_client_secret', $intent->get_client_secret() );
		$o->save();

		$acct = sm_appliance_account();
		return rest_ensure_response( array(
			'client_secret'     => $intent->get_client_secret(),
			'wc_order_id'       => $wc_id,
			'payment_intent_id' => $intent->get_id(),
			'publishable_key'   => $acct['publishable_key'],
			'account_id'        => $acct['account_id'],
		) );
	} catch ( \Throwable $e ) {
		return new WP_Error( 'sm_charge_failed', $e->getMessage(), array( 'status' => 500 ) );
	}
}

/**
 * Sign and POST a bridge event to Counter's internal receiver. Non-blocking:
 * the charge/webhook path never waits on Counter, and delivery is idempotent
 * on Counter's side (markPaid pending → processing runs once).
 *
 * @param string $type        'payment.succeeded'.
 * @param string $sm_order_id Counter's Postgres order id (the source of truth).
 * @param string $txn_id      Stripe/intent transaction id, when known.
 * @return void
 */
function sm_appliance_notify( $type, $sm_order_id, $txn_id = '' ) {
	$body = wp_json_encode( array(
		'type'    => $type,
		'orderId' => (string) $sm_order_id,
		'txnId'   => (string) $txn_id,
		'method'  => 'woopay',
	) );
	$sig = hash_hmac( 'sha256', $body, defined( 'SM_BRIDGE_SECRET' ) ? SM_BRIDGE_SECRET : '' );
	wp_remote_post( 'http://127.0.0.1:10009/api/webhooks/woopay', array(
		'headers'  => array(
			'Content-Type'       => 'application/json',
			'x-therum-signature' => $sig,
		),
		'body'     => $body,
		'timeout'  => 5,
		'blocking' => false,
	) );
}

/**
 * Success: WCPay ran payment_complete() for our stub order. Tell Counter once.
 * (There is deliberately no failure notifier — see the header note.)
 */
add_action( 'woocommerce_payment_complete', function ( $order_id, $txn_id = '' ) {
	$o = wc_get_order( $order_id );
	if ( ! $o ) {
		return;
	}
	$sm = $o->get_meta( '_sm_order_id' );
	if ( ! $sm || $o->get_meta( '_sm_notified' ) ) {
		return;
	}
	sm_appliance_notify( 'payment.succeeded', (string) $sm, (string) $txn_id );
	$o->update_meta_data( '_sm_notified', 1 );
	$o->save();
}, 10, 2 );
