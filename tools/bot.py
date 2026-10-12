# Pursuit bot: plays each level with a simple breadcrumb-following autopilot to
# sanity-check that catches happen and par times are fair.
import sys, json
from playwright.sync_api import sync_playwright
URL="http://localhost:5184/"
BOT = r"""
([lvl, maxT]) => {
  const G = window.__vd; G.frozen = true; G.debug.start(lvl);
  G.debug.step(2.4);
  const W = G.world, nodes = W.nodes;
  const wrap = (a)=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
  const los = (ax,az,bx,bz) => { const L=Math.hypot(bx-ax,bz-az); const nx=-(bz-az)/L*0.6, nz=(bx-ax)/L*0.6;
    for (let t=1.5;t<=L;t+=0.5){ const x=ax+(bx-ax)*t/L, z=az+(bz-az)*t/L; if (W.isSolid(x,z)||W.isSolid(x+nx,z+nz)||W.isSolid(x-nx,z-nz)||W.collide(x,z,0.3).hit) return false; } return true; };
  const dij = (src) => { const dist = new Float64Array(nodes.length).fill(1e9); dist[src]=0; const open=[src];
    while(open.length){ open.sort((a,b)=>dist[a]-dist[b]); const v=open.shift();
      for(const a of nodes[v].adj){ const nd=dist[v]+a.e.len; if(nd<dist[a.to]){dist[a.to]=nd; open.push(a.to);} } } return dist; };
  let dist = null, replan = 0, n = 0, stuckT = 0; const log = [];
  let target = null;
  while (G.state === 'play' && G.timer < maxT) {
    const b = G.bike, d = G.dog;
    replan -= 1/60;
    const dd = Math.hypot(d.x-b.x, d.z-b.z);
    if (replan <= 0) {
      replan = 0.25;
      if (dd < 35 && los(b.x,b.z,d.x,d.z)) target = null;
      else {
        dist = dij(d.to);
        let best = null, bc = 1e9;
        for (const nd of nodes) { const e = Math.hypot(nd.x-b.x, nd.z-b.z); if (e > 45 || e < 2.5) continue; if (!los(b.x,b.z,nd.x,nd.z)) continue;
          const c = e + dist[nd.id]; if (c < bc) { bc = c; best = nd; } }
        target = best;
      }
    }
    let tx = d.x, tz = d.z;
    if (target) { tx = target.x; tz = target.z; if (Math.hypot(tx-b.x,tz-b.z) < 2.5) replan = 0; }
    const want = Math.atan2(-(tx-b.x), -(tz-b.z));
    const diff = wrap(want - b.yaw);
    const sp = b.speed, td = Math.hypot(tx-b.x, tz-b.z);
    let inp = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -diff*2.5)), drift: false };
    if (Math.abs(diff) > 0.6 && sp > 6) { inp.throttle = 0; inp.brake = 0.7; inp.drift = Math.abs(diff) > 1.0; }
    if (target && td < sp * 0.7 && sp > 9) { inp.throttle = 0; inp.brake = 0.5; }
    if (dd < 8) { const ds = d.speed + (dd > 2.5 ? 1.5 : 0); if (sp > ds + 0.5) { inp.throttle = 0; inp.brake = 0.5; } else if (sp > ds) inp.throttle = 0.3; }
    if (sp < 0.6) stuckT += 1/60; else stuckT = 0;
    if (stuckT > 1.2) { G.debug.reset(); stuckT = 0; replan = 0; }
    G.botInput = inp;
    G.debug.step(1/60);
    n++;
    if (n % 300 === 0) log.push([+G.timer.toFixed(1), +dd.toFixed(1), d.state, +d.stamina.toFixed(0), [b.x|0, b.z|0], [d.x|0, d.z|0]]);
  }
  G.botInput = null;
  const res = { level: lvl, state: G.state, time: +G.timer.toFixed(1), how: G.caughtHow, crashes: G.crashes, log };
  if (G.state === 'caught') { G.debug.step(3); res.after = G.state; }
  return res;
}
"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    pg=b.new_page(viewport={"width":640,"height":400})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(m.type+": "+m.text) if m.type in ("error","warning") else None)
    pg.goto(URL); pg.wait_for_timeout(2500)
    if '--trace' in sys.argv: pg.evaluate('window.TRACE=1')
    for lvl in [int(a) for a in sys.argv[1:] if a.isdigit()] or [0,1,2]:
        r = pg.evaluate(BOT, [lvl, 240])
        print(json.dumps(r))
    print("\n".join(errs) or "no errors")
    b.close()
