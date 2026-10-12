from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.goto("http://localhost:5184/"); pg.wait_for_timeout(3000)
    print(pg.evaluate("""() => { const G=__vd; G.frozen=true; G.debug.start(2); G.debug.step(2.4);
      const w=G.world; const f=w.fields.find(f=>f.orchard) || w.fields[0]; const A=w.nodes[f.a], B=w.nodes[f.b];
      const L=Math.hypot(B.x-A.x,B.z-A.z), ex=(B.x-A.x)/L, ez=(B.z-A.z)/L;
      // dog runs ahead along the diagonal, bike behind it
      const d=G.dog; const e=A.adj.find(a=>a.to===B.id).e; d.place(A.id,B.id,e,16); d.state='run';
      G.bike.reset(A.x+ex*5, A.z+ez*5, Math.atan2(-ex,-ez)); G.debug.setBikeSpeed(8); G.debug.step(0.3);
      G.frozen=false; G.simPaused=true; return JSON.stringify({f, surf: w.surfaceAt(G.bike.x,G.bike.z)}); }"""))
    pg.wait_for_timeout(2500); pg.screenshot(path="/workspace/village-dash/screenshots/extra-orchard-field.png")
    b.close()
