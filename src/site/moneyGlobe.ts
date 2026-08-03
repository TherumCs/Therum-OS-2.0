// The rotating money planet for the coming-soon page.
//
// A REAL 3D sphere in WebGL, not a spun photo: the surface rotates around a
// vertical axis so it reads as a planet turning, with the far edge falling into
// shadow. Self-contained — no library, no external asset — so it respects the
// page's `script-src 'self'` and works offline.
//
// Two surface modes:
//   - A texture URL (an equirectangular money collage) is wrapped onto the
//     sphere and rotated. This is the path for a photoreal render.
//   - With no texture, a procedural battered-banknote surface is generated in
//     the shader: cool-toned patchwork panels, fine guilloché linework, tape
//     seams and stitching. Not photoreal, but a genuine rotating money planet
//     that needs nothing uploaded.
//
// Falls back to a static shaded orb if WebGL is unavailable or the viewer asked
// to reduce motion — a decorative spin is exactly what that setting turns off.

export function moneyGlobe(textureUrl?: string | null): { markup: string; css: string; script: string } {
  const tex = textureUrl ? textureUrl.replace(/'/g, '') : '';

  const markup = `
  <div class="globe" aria-hidden="true">
    <canvas class="globe__c" width="900" height="900"></canvas>
    <div class="globe__fallback"></div>
  </div>`;

  const css = `
  /* Deep-space ground, edge to edge, behind everything. */
  body.coming{background:#07080b}
  .space{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
    background:
      radial-gradient(120% 90% at 50% 8%, rgba(60,50,90,.28) 0%, rgba(20,22,40,.10) 40%, transparent 70%),
      radial-gradient(80% 60% at 78% 76%, rgba(40,70,110,.22) 0%, transparent 60%),
      radial-gradient(100% 100% at 50% 50%, #12131c 0%, #0a0b12 55%, #06070a 100%)}
  /* Starfield: two tiled layers of tiny points, one drifting slowly. */
  .space::before,.space::after{content:"";position:absolute;inset:-50%;
    background-image:
      radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.9) 0, transparent 2px),
      radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,.7) 0, transparent 2px),
      radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,.6) 0, transparent 2px),
      radial-gradient(1.5px 1.5px at 85% 20%, rgba(255,255,255,.85) 0, transparent 2px),
      radial-gradient(1px 1px at 55% 15%, rgba(200,220,255,.7) 0, transparent 2px),
      radial-gradient(1px 1px at 10% 65%, rgba(255,240,220,.6) 0, transparent 2px);
    background-size:340px 340px}
  .space::after{background-size:520px 520px;opacity:.6;animation:drift 140s linear infinite}
  @keyframes drift{to{transform:translate(-160px,-120px)}}

  .globe{position:relative;z-index:2;width:min(52vmin,440px);aspect-ratio:1/1;margin:0 auto 34px;
    filter:drop-shadow(0 30px 60px rgba(0,0,0,.55))}
  .globe__c{width:100%;height:100%;display:block}
  /* Static fallback orb — shown only if WebGL/motion is off (see script). */
  .globe__fallback{display:none;position:absolute;inset:0;border-radius:50%;
    background:
      radial-gradient(38% 34% at 34% 30%, rgba(255,255,255,.35), transparent 60%),
      radial-gradient(120% 120% at 68% 74%, #1c2a22 0%, #26352b 30%, #33413a 55%, #1a2119 100%);
    box-shadow:inset -18px -22px 60px rgba(0,0,0,.7), inset 12px 14px 40px rgba(255,255,255,.06)}
  @media (prefers-reduced-motion: reduce){
    .globe__c{display:none}
    .globe__fallback{display:block}
  }`;

  // The renderer. Kept in one IIFE, guards every failure back to the CSS orb.
  const script = `
(function(){
  var wrap = document.querySelector('.globe');
  var canvas = wrap && wrap.querySelector('.globe__c');
  var fallback = wrap && wrap.querySelector('.globe__fallback');
  if (!canvas) return;
  function bail(){ if (canvas) canvas.style.display='none'; if (fallback) fallback.style.display='block'; }

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { bail(); return; }

  var gl = canvas.getContext('webgl', { alpha:true, premultipliedAlpha:false, antialias:true })
        || canvas.getContext('experimental-webgl', { alpha:true });
  if (!gl) { bail(); return; }

  var TEX_URL = ${JSON.stringify(tex)};

  var vsrc = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p; gl_Position = vec4(p,0.0,1.0); }';

  // Fragment shader. A ray from the camera hits a unit sphere; the hit point is
  // rotated around Y by time (the planet spinning) and shaded from the upper
  // left, with the surface either sampled from a texture or generated.
  var fsrc = [
    'precision highp float;',
    'varying vec2 uv;',
    'uniform float t;',
    'uniform sampler2D tex;',
    'uniform int useTex;',
    'const float PI = 3.14159265;',

    // hash / value noise for the procedural surface
    'float h(vec2 x){ return fract(sin(dot(x, vec2(127.1,311.7))) * 43758.5453); }',
    'float vnoise(vec2 x){ vec2 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);',
    '  float a=h(i), b=h(i+vec2(1,0)), c=h(i+vec2(0,1)), d=h(i+vec2(1,1));',
    '  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }',

    // A patchwork of taped banknote panels in cool, desaturated tones.
    'vec3 notes(vec2 sc){',
    '  vec2 grid = vec2(7.0, 4.0);',            // panels around / up
    '  vec2 cell = floor(sc*grid);',
    '  vec2 f = fract(sc*grid);',
    '  float r1 = h(cell), r2 = h(cell+7.3);',
    // per-panel base hue: greens, blue-greys, muted golds, faint purples
    '  vec3 green = vec3(0.42,0.50,0.42);',
    '  vec3 grey  = vec3(0.52,0.55,0.58);',
    '  vec3 gold  = vec3(0.60,0.55,0.42);',
    '  vec3 plum  = vec3(0.50,0.46,0.56);',
    '  vec3 base = green;',
    '  if (r1 > 0.72) base = grey; else if (r1 > 0.5) base = gold; else if (r1 > 0.34) base = plum;',
    '  base *= 0.82 + 0.30*r2;',
    // fine guilloché linework — high-frequency interference, panel-oriented
    '  float ang = (r2-0.5)*1.2;',
    '  vec2 rr = mat2(cos(ang),-sin(ang),sin(ang),cos(ang)) * (f-0.5);',
    '  float lines = 0.5 + 0.5*sin(rr.x*90.0)*sin(rr.y*70.0 + r1*10.0);',
    '  float micro = 0.5 + 0.5*sin((rr.x+rr.y)*160.0);',
    '  base *= 0.80 + 0.20*lines;',
    '  base += (micro-0.5)*0.04;',
    // portrait oval hint in some panels
    '  float oval = smoothstep(0.34,0.30, length((f-vec2(0.5,0.52))*vec2(1.3,1.0)));',
    '  base = mix(base, base*1.05, oval*step(0.5,r1)*0.5);',
    // seams: darken near cell borders; occasional bright tape strip
    '  float seam = smoothstep(0.0,0.04,f.x)*smoothstep(0.0,0.04,f.y)*smoothstep(0.0,0.04,1.0-f.x)*smoothstep(0.0,0.04,1.0-f.y);',
    '  base *= 0.55 + 0.45*seam;',
    '  float tape = smoothstep(0.46,0.48,f.y)*smoothstep(0.54,0.52,f.y)*step(0.82,h(cell+31.7));',
    '  base = mix(base, base+0.10, tape*0.6);',
    // stitching dots along some seams
    '  float st = step(0.85, fract(f.x*12.0)) * smoothstep(0.02,0.0,abs(f.y-0.02)) * step(0.6,r2);',
    '  base -= st*0.15;',
    // grime + cool desaturated grade
    '  base *= 0.86 + 0.22*vnoise(sc*60.0);',
    '  float g = dot(base, vec3(0.299,0.587,0.114));',
    '  base = mix(vec3(g), base, 0.72) * vec3(0.94,0.99,1.04);',
    '  return clamp(base, 0.0, 1.0);',
    '}',

    'void main(){',
    '  vec2 p = uv;',
    '  float r2 = dot(p,p);',
    '  if (r2 > 0.98) { gl_FragColor = vec4(0.0); return; }',   // outside the disc: transparent
    '  float z = sqrt(max(0.0, 1.0 - r2));',
    '  vec3 N = vec3(p, z);',                                    // sphere normal at this pixel
    // rotate the SURFACE point around Y by time to spin the planet
    '  float a = t * 0.12;',
    '  mat3 R = mat3(cos(a),0.0,sin(a), 0.0,1.0,0.0, -sin(a),0.0,cos(a));',
    '  vec3 sp = R * N;',
    '  float lon = atan(sp.z, sp.x) / (2.0*PI) + 0.5;',
    '  float lat = asin(clamp(sp.y,-1.0,1.0)) / PI + 0.5;',
    '  vec3 albedo;',
    '  if (useTex == 1) { albedo = texture2D(tex, vec2(lon, 1.0-lat)).rgb; }',
    '  else { gl_FragColor = vec4(0.0); return; }',
    // lighting: key from upper-left-front
    '  vec3 L = normalize(vec3(-0.55, 0.60, 0.75));',
    '  float diff = max(dot(N, L), 0.0);',
    '  vec3 V = vec3(0.0,0.0,1.0);',
    '  vec3 H = normalize(L + V);',
    '  float spec = pow(max(dot(N,H),0.0), 48.0) * 0.10;',      // soft sheen on tape/foil
    '  float rim = pow(1.0 - z, 2.2) * 0.5;',                    // curvature darkening at the edge
    '  vec3 col = albedo * (0.20 + 0.95*diff) + spec;',
    '  col *= (1.0 - rim);',
    '  col = mix(col, col*vec3(0.82,0.88,1.0), rim*0.6);',       // edge cools toward space
    '  float edge = smoothstep(0.98, 0.94, r2);',                // antialias the silhouette
    '  gl_FragColor = vec4(col, edge);',
    '}'
  ].join('\\n');

  function compile(type, src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ return null; } return s; }
  var vs = compile(gl.VERTEX_SHADER, vsrc), fs = compile(gl.FRAGMENT_SHADER, fsrc);
  if(!vs || !fs){ bail(); return; }
  var prog = gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){ bail(); return; }
  gl.useProgram(prog);

  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog,'p'); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var uT = gl.getUniformLocation(prog,'t');
  var uUseTex = gl.getUniformLocation(prog,'useTex');
  var uTex = gl.getUniformLocation(prog,'tex');
  gl.uniform1i(uUseTex, 0);

  // Optional real texture. Only used once it loads; the procedural surface
  // shows meanwhile, so there is never a blank sphere.
  if (TEX_URL) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function(){
      var texObj = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texObj);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(uTex, 0);
      gl.uniform1i(uUseTex, 1);
    };
    img.onerror = function(){ /* keep the procedural surface */ };
    img.src = TEX_URL;
  }

  gl.clearColor(0,0,0,0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  var start = null;
  function frame(ts){
    if (start === null) start = ts;
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, (ts - start) / 1000.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();`;

  return { markup, css, script };
}
