# End-to-end test + screenshots in headless Chrome (SwiftShader WebGL).
import json, sys, time
from playwright.sync_api import sync_playwright
URL = "http://localhost:5184/"
OUT = "/workspace/village-dash/screenshots/"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"]
results = []
def check(name, ok, info=""):
    results.append((name, bool(ok), info)); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(info) if info else ""))

def render(pg, ms=1800):
    pg.evaluate("() => { __vd.frozen = false; __vd.simPaused = true; }")
    pg.wait_for_timeout(ms)

def freeze(pg):
    pg.evaluate("() => { __vd.frozen = true; __vd.simPaused = false; }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(URL); pg.evaluate("() => localStorage.clear()"); pg.goto(URL)
    pg.wait_for_timeout(3500)
    gl = pg.evaluate("() => { const c = document.querySelector('#game canvas'); const g = c.getContext('webgl2'); return g ? g.getParameter(g.RENDERER) : 'none'; }")
    check("WebGL context", gl != "none", gl)
    check("start screen visible", pg.is_visible("#menu") and pg.evaluate("() => __vd.state") == "menu")
    pg.screenshot(path=OUT + "01-start-screen.png")

    # ---- start level 1 via the Play button, then drive with the keyboard ----
    pg.click("#playBtn"); pg.wait_for_timeout(300)
    freeze(pg)
    check("countdown after Play", pg.evaluate("() => __vd.state") == "countdown")
    r = pg.evaluate("() => __vd.debug.step(2.4)")
    check("game starts (state=play)", r["state"] == "play", r)
    b0 = pg.evaluate("() => [__vd.bike.x, __vd.bike.z, __vd.dog.x, __vd.dog.z, __vd.bike.yaw]")
    pg.keyboard.down("KeyW")
    r = pg.evaluate("() => __vd.debug.step(1.6)")
    pg.keyboard.down("KeyD")
    r2 = pg.evaluate("() => __vd.debug.step(0.4)")
    pg.keyboard.up("KeyD"); pg.keyboard.up("KeyW")
    b1 = pg.evaluate("() => [__vd.bike.x, __vd.bike.z, __vd.dog.x, __vd.dog.z, __vd.bike.yaw, __vd.bike.speed]")
    moved = ((b1[0]-b0[0])**2 + (b1[1]-b0[1])**2) ** 0.5
    dogmoved = ((b1[2]-b0[2])**2 + (b1[3]-b0[3])**2) ** 0.5
    check("keyboard W moves the bike", moved > 6, f"moved {moved:.1f} m, speed {b1[5]*3.6:.0f} km/h")
    check("keyboard D steers (yaw changed)", abs(b1[4] - b0[4]) > 0.05, f"yaw {b0[4]:.2f} -> {b1[4]:.2f}")
    check("dog moves", dogmoved > 8, f"dog moved {dogmoved:.1f} m")
    # drift: space + steer leaves tire marks
    pg.evaluate("() => { __vd.debug.teleportBehindDog(12); __vd.debug.setBikeSpeed(11); }")
    pg.keyboard.down("KeyW"); pg.evaluate("() => __vd.debug.step(0.2)"); pg.keyboard.down("Space"); pg.keyboard.down("KeyA")
    pg.evaluate("() => __vd.debug.step(0.7)")
    for k in ("Space", "KeyA", "KeyW"): pg.keyboard.up(k)
    marks = pg.evaluate("() => __vd.marksCount ? __vd.marksCount() : -1")
    check("drift leaves tire marks", marks > 0, f"{marks} marks")
    # Esc pause / resume
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    check("Esc pauses", pg.evaluate("() => __vd.state") == "paused" and pg.is_visible("#pause"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("Esc resumes", pg.evaluate("() => __vd.state") == "play")
    # R resets the bike onto the street, M toggles mute
    pg.keyboard.press("KeyR"); pg.wait_for_timeout(150)
    sp = pg.evaluate("() => __vd.bike.speed")
    check("R resets the bike", sp < 0.5, f"speed after reset {sp:.2f}")
    m0 = pg.evaluate("() => document.querySelector('#muteBtn').textContent")
    pg.keyboard.press("KeyM"); pg.wait_for_timeout(100)
    m1 = pg.evaluate("() => document.querySelector('#muteBtn').textContent")
    pg.keyboard.press("KeyM")
    check("M toggles mute", m0 != m1, f"{m0} -> {m1}")
    freeze(pg)

    # ---- mid-chase POV screenshot ----
    pg.evaluate("() => { __vd.debug.teleportBehindDog(11); __vd.debug.setBikeSpeed(__vd.dog.speed * 0.9); }")
    pg.keyboard.down("KeyW"); pg.keyboard.down("KeyD"); pg.evaluate("() => __vd.debug.step(0.12)"); pg.keyboard.up("KeyD"); pg.evaluate("() => __vd.debug.step(0.1)"); pg.keyboard.up("KeyW")
    info = pg.evaluate("() => ({dist: __vd.dog.dist, state: __vd.dog.state, speed: __vd.bike.speed})")
    render(pg, 2500)
    pg.screenshot(path=OUT + "02-mid-chase-pov.png")
    check("mid-chase screenshot taken (dog ahead)", info["dist"] < 15, info)
    freeze(pg)

    # ---- trigger a catch by matching the pup's speed right behind it ----
    caught = pg.evaluate("""() => {
      const G = __vd; G.debug.teleportBehindDog(1.8); G.debug.setBikeSpeed(G.dog.speed);
      const wrap = (a)=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
      for (let i = 0; i < 360 && G.state === 'play'; i++) {
        const b = G.bike, d = G.dog;
        const want = Math.atan2(-(d.x-b.x), -(d.z-b.z)); const diff = wrap(want - b.yaw);
        const fd = Math.hypot(d.x - (b.x + b.fx*0.9), d.z - (b.z + b.fz*0.9));
        const ds = d.speed + (fd > 2 ? 1 : -0.5);
        G.botInput = { throttle: b.speed < ds ? 1 : 0, brake: b.speed > ds + 0.8 ? 0.4 : 0, steer: Math.max(-1, Math.min(1, -diff * 2.5)), drift: false };
        if (i % 30 === 0 && fd > 3.5) { G.debug.teleportBehindDog(1.8); G.debug.setBikeSpeed(d.speed); }
        G.debug.step(1/60);
      }
      G.botInput = null;
      return { state: G.state, how: G.caughtHow, t: G.timer };
    }""")
    check("catch triggered", caught["state"] == "caught", caught)
    pg.evaluate("() => __vd.debug.step(1.4)")
    render(pg, 2500)
    pg.screenshot(path=OUT + "03-catch-got-you-buddy.png")
    freeze(pg)
    r = pg.evaluate("() => __vd.debug.step(2.0)")
    pg.evaluate("() => { __vd.frozen = false; __vd.simPaused = false; }")
    pg.wait_for_timeout(1500)
    check("results screen shows", pg.is_visible("#results") and r["state"] == "results", r["state"])
    res_txt = pg.inner_text("#results .card")
    check("results has time/stars/best", "Best time" in res_txt and "★" in pg.inner_html("#rStars"), res_txt.replace("\n", " | ")[:160])
    pg.screenshot(path=OUT + "04-results.png")
    best = pg.evaluate("() => localStorage.getItem('vd.best.village')")
    check("best time saved to localStorage", best is not None, best)
    # restart works
    pg.click("#rRetry"); pg.wait_for_timeout(500)
    check("Retry restarts level", pg.evaluate("() => __vd.state") in ("countdown", "play"))
    # all 3 levels build
    for i in range(3):
        st = pg.evaluate(f"() => {{ __vd.frozen = true; __vd.debug.start({i}); return {{ s: __vd.world.stats, W: __vd.world.W, H: __vd.world.H, state: __vd.state }}; }}")
        check(f"level {i+1} builds", st["state"] == "countdown", st)
    pg.evaluate("() => { __vd.frozen = false; }")
    pg.wait_for_timeout(2000)
    fps = pg.evaluate("() => __vd.fps")
    print(f"software-GL fps (SwiftShader, not representative): {fps:.1f}")
    check("no console errors (landscape)", not errs, errs[:5])
    ctx.close()

    # ---- portrait phone ----
    ctx = b.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=1, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs2 = []
    pg.on("console", lambda m: errs2.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs2.append("pageerror: " + str(e)))
    pg.goto(URL); pg.wait_for_timeout(3000)
    pg.screenshot(path=OUT + "06-portrait-start.png")
    pg.tap("#playBtn"); pg.wait_for_timeout(300)
    freeze(pg)
    pg.evaluate("() => __vd.debug.step(2.4)")
    # touch throttle via the on-screen GO button
    box = pg.locator("#tGas").bounding_box()
    check("touch controls visible", box is not None and pg.is_visible("#tPad"), box)
    pg.evaluate("() => { __vd.debug.teleportBehindDog(8); __vd.debug.setBikeSpeed(__vd.dog.speed); __vd.debug.step(0.3); }")
    render(pg, 2500)
    pg.screenshot(path=OUT + "05-portrait-chase.png")
    check("no console errors (portrait)", not errs2, errs2[:5])
    b.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
