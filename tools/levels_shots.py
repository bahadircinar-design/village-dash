# Extra POV screenshots of levels 2 and 3 (and the red-car hiding spot).
from playwright.sync_api import sync_playwright
OUT = "/workspace/village-dash/screenshots/"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.goto("http://localhost:5184/"); pg.wait_for_timeout(3000)
    for lvl, name, secs in [(1, "extra-market-alleys.png", 6), (2, "extra-orchard-run.png", 9)]:
        pg.evaluate(f"""() => {{ const G=__vd; G.frozen=true; G.debug.start({lvl}); G.debug.step(2.4); G.debug.step({secs});
          // put the bike behind the pup; prefer a moment when it's on a dirt/field edge for the orchard
          for (let i=0;i<600 && {lvl}===2 && G.dog.edge.kind!=='field';i++) G.debug.step(0.1);
          G.debug.teleportBehindDog(10); G.debug.setBikeSpeed(G.dog.speed*0.9); G.debug.step(0.2);
          G.frozen=false; G.simPaused=true; }}""")
        pg.wait_for_timeout(2500); pg.screenshot(path=OUT + name)
    # red car hiding spot
    pg.evaluate("""() => { const G=__vd; G.frozen=true; G.debug.start(0); G.debug.step(2.4);
      const d=G.dog, w=G.world, rc=w.redCar; const J=w.nodes[rc.junction];
      d.goingHome=true; d.state='hiding'; d.from=rc.junction; d.to=rc.node; d.edge=rc.edge; d.s=rc.edge.len; d.update(0.016,G.bike); d.rx=d.x; d.rz=d.z; for(let i=0;i<30;i++) d.update(1/60,G.bike);
      G.bike.reset(J.x + rc.dx*1.5, J.z + rc.dz*1.5, Math.atan2(-rc.dx,-rc.dz));
      G.frozen=false; G.simPaused=true; }""")
    pg.wait_for_timeout(2500); pg.screenshot(path=OUT + "extra-red-car-hiding.png")
    b.close()
