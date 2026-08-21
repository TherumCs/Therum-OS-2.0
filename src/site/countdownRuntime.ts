// Live countdown ticker, site-wide but inert unless a [data-countdown-to]
// element is on the page (the homepage Sixers pre-order panel is the only one
// today). Fills that element's `.tsc-cd__timer` with days/hours/mins/secs down
// to the target ISO time; past the target it reads "Live now" rather than
// ticking negative. Runs from the site chrome's own <script>, so it is covered
// by the page CSP — no per-content inline script needed.
export const COUNTDOWN_RUNTIME = `(function(){
  var els=document.querySelectorAll('[data-countdown-to]');
  if(!els.length)return;
  function pad(n){return (n<10?'0':'')+n;}
  var LB=['Days','Hrs','Min','Sec'];
  function tick(){
    var now=Date.now();
    for(var i=0;i<els.length;i++){
      var el=els[i], timer=el.querySelector('.tsc-cd__timer'); if(!timer)continue;
      var t=Date.parse(el.getAttribute('data-countdown-to')); if(isNaN(t))continue;
      var d=t-now;
      if(d<=0){ timer.textContent='Live now'; continue; }
      var v=[Math.floor(d/86400000),Math.floor(d%86400000/3600000),Math.floor(d%3600000/60000),Math.floor(d%60000/1000)];
      // Build the four columns ONCE, then only rewrite the digits that change.
      // Rebuilding innerHTML every second reflowed the row and read as "jumping";
      // every value is 2-digit padded so the column width never shifts.
      if(timer.children.length!==4){ var html=''; for(var k=0;k<4;k++){ html+='<u><b>00</b><span>'+LB[k]+'</span></u>'; } timer.innerHTML=html; }
      var u=timer.children;
      for(var j=0;j<4;j++){ var b=u[j].firstChild, nv=pad(v[j]); if(b.textContent!==nv) b.textContent=nv; }
    }
  }
  tick(); setInterval(tick,1000);
})();`;
