// src/components/plays/Play3DViewer.tsx
// "Watch in 3D" — renders the same play data PlayCanvas draws in 2D, but
// as a Three.js scene. Desktop gets free-orbit camera controls; mobile
// gets a row of preset camera angles instead (easier with a finger than
// a drag-to-orbit gesture). Player avatars show their roster photo on a
// billboard "head" sprite when available, falling back to a plain
// colored sphere otherwise.
//
// Requires the `three` package: npm install three && npm install -D @types/three

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Play, RosterPlayer, PlayFrame } from "../../lib/plays";
import { courtLines, hoopPositions } from "./courtGeometry";

interface Props {
  play: Play;
  roster: Record<string, RosterPlayer>;
  onBack: () => void;
  /** Viewer-only, local override — renders this one player (by stable id) with the viewer's own avatar, mirroring the same feature in the 2D canvas. */
  selfOverride?: { playerId: string; avatarUrl: string | null } | null;
}

const FACE_COLORS = [0x378add, 0x639922, 0xd85a30, 0xd4537e, 0x7f77dd];
const SCALE = 40; // divides the 600x420 2D coordinate space down to world units
const toWorld = (x: number, y: number) => ({ x: (x - 300) / SCALE, z: (y - 210) / SCALE });

const PRESETS_DESKTOP: { label: string; pos: [number, number, number]; lookAt?: [number, number, number] }[] = [
  { label: "Half court", pos: [0, 4, 9] },
  { label: "Baseline", pos: [3, 5, -15], lookAt: [1, 1, 3] },
  { label: "Sideline", pos: [11, 4, 0] },
  { label: "Top-down", pos: [0, 13, 0.5] },
  { label: "Full court", pos: [0, 11, 15] },
];

// Mobile screens are narrower relative to height than a laptop window, so
// the same camera distance shows less of the court side-to-side — this
// scales each preset further out along its own line of sight (from
// whatever it's looking at, not just from the origin), so the framing/angle
// stays the same as desktop, just pulled back.
function zoomedOut(preset: typeof PRESETS_DESKTOP[number], factor: number) {
  const target = preset.lookAt ?? [0, 0, 0];
  const pos: [number, number, number] = [
    target[0] + (preset.pos[0] - target[0]) * factor,
    target[1] + (preset.pos[1] - target[1]) * factor,
    target[2] + (preset.pos[2] - target[2]) * factor,
  ];
  return { ...preset, pos };
}
const PRESETS_MOBILE = PRESETS_DESKTOP.map((p) => zoomedOut(p, 2.15));

export default function Play3DViewer({ play, roster, onBack, selfOverride = null }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [frameIdx, setFrameIdx] = useState(0);

  // Mutable refs so the render loop (set up once) can read current props/state.
  const stateRef = useRef({ play, roster, frameIdx, selfOverride });
  stateRef.current = { play, roster, frameIdx, selfOverride };

  const [isPlaying, setIsPlaying] = useState(false);
  const [presets] = useState(() => (window.innerWidth < 768 ? PRESETS_MOBILE : PRESETS_DESKTOP));
  const [presetLabel, setPresetLabel] = useState(presets[0].label);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current!;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(...presets[0].pos);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // Floor
    const floorW = 592 / SCALE, floorD = 412 / SCALE;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW, floorD),
      new THREE.MeshStandardMaterial({ color: 0x3a2a17 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Court markings, converted from the shared 2D geometry
    const lineMat = new THREE.LineBasicMaterial({ color: 0xb0b8c8 });
    courtLines(play.court_template).forEach((poly) => {
      const pts = poly.map((p) => { const w = toWorld(p.x, p.y); return new THREE.Vector3(w.x, 0.02, w.z); });
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    });

    // Hoops (a raised rim so the court reads as a real court, not just lines)
    hoopPositions(play.court_template).forEach((hp) => {
      const w = toWorld(hp.x, hp.y);
      // Direction from court center out to the hoop — the backboard sits
      // further along this same direction, facing back toward center.
      const dist = Math.hypot(w.x, w.z) || 1;
      const dirX = w.x / dist, dirZ = w.z / dist;
      const rimHeight = 2.0;

      const hoopGroup = new THREE.Group();

      // Support pole + arm (floor to backboard)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, rimHeight, 8), new THREE.MeshStandardMaterial({ color: 0x555555 }));
      pole.position.set(w.x + dirX * 0.45, rimHeight / 2, w.z + dirZ * 0.45);
      hoopGroup.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x555555 }));
      arm.position.set(w.x + dirX * 0.22, rimHeight, w.z + dirZ * 0.22);
      arm.rotation.y = Math.atan2(dirZ, dirX);
      hoopGroup.add(arm);

      // Backboard (a bit further out than the rim, facing back toward center)
      const backboard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 1.1), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      backboard.position.set(w.x + dirX * 0.42, rimHeight + 0.15, w.z + dirZ * 0.42);
      backboard.rotation.y = Math.atan2(dirZ, dirX);
      hoopGroup.add(backboard);
      const backboardStripe = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0xdd3333 }));
      backboardStripe.position.copy(backboard.position);
      backboardStripe.position.y -= 0.05;
      backboardStripe.rotation.y = backboard.rotation.y;
      hoopGroup.add(backboardStripe);

      // Rim
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 24), new THREE.MeshStandardMaterial({ color: 0xff6a1a }));
      rim.position.set(w.x, rimHeight, w.z);
      rim.rotation.x = Math.PI / 2;
      hoopGroup.add(rim);

      // Net — a loose wireframe cone hanging from the rim. ConeGeometry
      // defaults to apex-up/base-down; rotated 180° so the wide opening
      // faces up into the rim and it narrows to a point hanging below.
      const net = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 0.42, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xf2f2f2, wireframe: true, transparent: true, opacity: 0.8 })
      );
      net.rotation.x = Math.PI;
      net.position.set(w.x, rimHeight - 0.21, w.z);
      hoopGroup.add(net);

      scene.add(hoopGroup);
    });

    // Free orbit is available everywhere now; presets give a quick way to
    // snap to a good angle first, then fine-tune by dragging from there.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49; // don't let the camera dip below the floor
    controls.target.set(0, 0, 0);

    // Entity groups, rebuilt whenever the current frame changes
    let playerGroups: THREE.Group[] = [];
    let defenderGroups: THREE.Group[] = [];
    let ballMesh: THREE.Mesh | null = null;
    const textureLoader = new THREE.TextureLoader();

    function clearEntities() {
      [...playerGroups, ...defenderGroups].forEach((g) => scene.remove(g));
      if (ballMesh) scene.remove(ballMesh);
      playerGroups = []; defenderGroups = []; ballMesh = null;
    }

    // Mirrors the 2D canvas's getBallPos — the ball follows whoever holds
    // it (by id) rather than relying only on its own stored x/y, which can
    // go stale if the holder was moved without the stored ball position
    // being touched.
    function getBallWorldPos(f: PlayFrame) {
      if (f.ballHolderId) {
        const holder = f.players.find((p) => p.id === f.ballHolderId);
        if (holder) return toWorld(holder.x, holder.y);
      }
      return f.ball ? toWorld(f.ball.x, f.ball.y) : null;
    }

    // A small floating badge showing the jersey number, so it's readable in 3D
// without cross-referencing the 2D view — shown on every player regardless
// of whether they also have a photo avatar.
function makeNumberBadgeTexture(num: number, hexColor: number): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const colorStr = "#" + hexColor.toString(16).padStart(6, "0");
  ctx.fillStyle = "#111828";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorStr;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function buildEntities(frame: PlayFrame, rosterMap: Record<string, RosterPlayer>, selfOv: { playerId: string; avatarUrl: string | null } | null) {
      clearEntities();
      frame.players.forEach((p, i) => {
        const color = FACE_COLORS[(p.num - 1 + 5) % 5];
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), new THREE.MeshStandardMaterial({ color }));
        body.position.y = 0.55;
        g.add(body);

        const isSelf = !!(selfOv && p.id === selfOv.playerId);
        const avatarUrl = isSelf ? selfOv!.avatarUrl : (p.profile_id ? rosterMap[p.profile_id]?.avatar_url : null);
        if (avatarUrl) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
          sprite.position.y = 1.2;
          sprite.scale.set(0.5, 0.5, 0.5);
          textureLoader.load(
            avatarUrl,
            (tex) => { (sprite.material as THREE.SpriteMaterial).map = tex; (sprite.material as THREE.SpriteMaterial).needsUpdate = true; },
            undefined,
            (err) => console.error("3D avatar texture failed to load:", avatarUrl, err)
          );
          g.add(sprite);
        } else {
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), new THREE.MeshStandardMaterial({ color }));
          head.position.y = 1.15;
          g.add(head);
        }

        const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNumberBadgeTexture(p.num, color) }));
        badge.position.set(0.24, avatarUrl ? 1.38 : 1.32, 0);
        badge.scale.set(0.22, 0.22, 0.22);
        g.add(badge);

        if (isSelf) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 24), new THREE.MeshBasicMaterial({ color: 0xf0c040, side: THREE.DoubleSide }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.02;
          g.add(ring);
        }

        const w = toWorld(p.x, p.y);
        g.position.set(w.x, 0, w.z);
        scene.add(g);
        playerGroups[i] = g;
      });
      frame.defenders.forEach((d, i) => {
        const g = new THREE.Group();
        const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), new THREE.MeshStandardMaterial({ color: 0x993c1d }));
        bar1.rotation.z = Math.PI / 4; bar1.position.y = 0.4;
        const bar2 = bar1.clone(); bar2.rotation.z = -Math.PI / 4;
        g.add(bar1, bar2);
        const w = toWorld(d.x, d.y);
        g.position.set(w.x, 0, w.z);
        scene.add(g);
        defenderGroups[i] = g;
      });
      const ballW = getBallWorldPos(frame);
      if (ballW) {
        ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0x552200, emissiveIntensity: 0.4 }));
        ballMesh.position.set(ballW.x, 0.5, ballW.z);
        scene.add(ballMesh);
      }
    }

    buildEntities(stateRef.current.play.data.frames[stateRef.current.frameIdx], stateRef.current.roster, stateRef.current.selfOverride);

    // Animation: tween from the current beat to the next while playing.
    // Uses elapsed-time-so-far rather than a fixed start timestamp, so
    // pausing/resuming doesn't need to fuss with clock offsets — elapsed
    // just stops accumulating while paused.
    let animFromFrame: PlayFrame | null = null;
    let animToFrame: PlayFrame | null = null;
    let elapsed = 0;
    let lastTickTime = performance.now();

    function beginNextBeat(): boolean {
      const { play: p, frameIdx: idx } = stateRef.current;
      const nextIdx = idx + 1;
      if (nextIdx >= p.data.frames.length) return false;
      animFromFrame = p.data.frames[idx];
      animToFrame = p.data.frames[nextIdx];
      elapsed = 0;
      return true;
    }

    function startOrResume() {
      if (!animFromFrame) {
        // Sitting idle — if we're already on the last beat, restart from the top.
        if (stateRef.current.frameIdx >= stateRef.current.play.data.frames.length - 1) {
          stateRef.current = { ...stateRef.current, frameIdx: 0 };
          setFrameIdx(0);
        }
        beginNextBeat();
      }
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
    function pause() {
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
    function togglePlayPause() {
      if (isPlayingRef.current) pause(); else startOrResume();
    }

    let raf = 0;
    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      const dt = now - lastTickTime;
      lastTickTime = now;
      if (animFromFrame && animToFrame) {
        if (isPlayingRef.current) elapsed += dt;
        const t = Math.min(1, elapsed / 1500);
        animFromFrame.players.forEach((fp, i) => {
          const tp = animToFrame!.players[i];
          if (!tp || !playerGroups[i]) return;
          // If this player's movement was drawn as a curl (curve set on
          // their cut/dribble/screen), follow that curve instead of
          // cutting straight from A to B — otherwise curved routes look
          // right in 2D but players run straight through each other in 3D.
          const sourced = fp.id ? animFromFrame!.actions.find(
            (a) => a.sourcePlayerId === fp.id && (a.type === "move" || a.type === "dribble" || a.type === "screen")
          ) : undefined;
          let x: number, z: number;
          if (sourced?.curve) {
            const mt = 1 - t;
            const w1 = toWorld(sourced.x1, sourced.y1), wc = toWorld(sourced.curve.x, sourced.curve.y), w2 = toWorld(sourced.x2, sourced.y2);
            x = mt * mt * w1.x + 2 * mt * t * wc.x + t * t * w2.x;
            z = mt * mt * w1.z + 2 * mt * t * wc.z + t * t * w2.z;
          } else {
            const from = toWorld(fp.x, fp.y), to = toWorld(tp.x, tp.y);
            x = from.x + (to.x - from.x) * t;
            z = from.z + (to.z - from.z) * t;
          }
          playerGroups[i].position.x = x;
          playerGroups[i].position.z = z;
        });
        if (ballMesh) {
          const fromBall = getBallWorldPos(animFromFrame);
          const toBall = getBallWorldPos(animToFrame);
          if (fromBall && toBall) {
            const passAction = [...animFromFrame.actions].reverse().find((a) => a.type === "pass" && a.targetPlayerId && a.curve);
            if (passAction?.curve) {
              const mt = 1 - t;
              const w1 = toWorld(passAction.x1, passAction.y1), wc = toWorld(passAction.curve.x, passAction.curve.y), w2 = toWorld(passAction.x2, passAction.y2);
              ballMesh.position.x = mt * mt * w1.x + 2 * mt * t * wc.x + t * t * w2.x;
              ballMesh.position.z = mt * mt * w1.z + 2 * mt * t * wc.z + t * t * w2.z;
            } else {
              ballMesh.position.x = fromBall.x + (toBall.x - fromBall.x) * t;
              ballMesh.position.z = fromBall.z + (toBall.z - fromBall.z) * t;
            }
          }
        }
        if (t >= 1) {
          const nextIdx = stateRef.current.frameIdx + 1;
          setFrameIdx(nextIdx);
          stateRef.current = { ...stateRef.current, frameIdx: nextIdx };
          const more = isPlayingRef.current && beginNextBeat();
          if (!more) {
            animFromFrame = null; animToFrame = null; elapsed = 0;
            if (isPlayingRef.current) pause();
          }
        }
      }
      controls.update();
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(tick);

    // Spacebar and a plain click on the scene both toggle play/pause,
    // matching standard video-player conventions.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" && e.key !== " ") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      togglePlayPause();
    }
    window.addEventListener("keydown", handleKeyDown);
    renderer.domElement.addEventListener("click", togglePlayPause);

    function handleResize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", handleResize);
    // ResizeObserver catches container-size changes window "resize" alone
    // misses on mobile (address bar collapsing, deferred layout on first
    // paint) — this is what was causing the squished look on phones.
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(mount);

    (mount as any)._rebuildForFrame = () => buildEntities(stateRef.current.play.data.frames[stateRef.current.frameIdx], stateRef.current.roster, stateRef.current.selfOverride);
    (mount as any)._setPreset = (pos: [number, number, number], lookAt?: [number, number, number]) => {
      camera.position.set(...pos);
      camera.lookAt(...(lookAt ?? [0, 0, 0]));
    };
    (mount as any)._togglePlayPause = togglePlayPause;

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      renderer.domElement.removeEventListener("click", togglePlayPause);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user picks a different beat manually (not via play animation), rebuild entities at that frame.
  useEffect(() => {
    (mountRef.current as any)?._rebuildForFrame?.();
  }, [frameIdx]);

  function handlePlayPauseClick() {
    (mountRef.current as any)?._togglePlayPause?.();
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ padding: "8px 12px", fontSize: 13 }}>← Back to 2D</button>
        <button onClick={handlePlayPauseClick} className="coach-add-btn" style={{ fontSize: 13 }}>{isPlaying ? "⏸ Pause" : "▶ Play"}</button>
        <select
          value={presetLabel}
          onChange={(e) => {
            setPresetLabel(e.target.value);
            const preset = presets.find((p) => p.label === e.target.value);
            if (preset) (mountRef.current as any)?._setPreset?.(preset.pos, preset.lookAt);
          }}
          style={{ marginLeft: "auto", padding: "7px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "inherit", outline: "none" }}
        >
          {presets.map((preset) => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
        </select>
      </div>
      <div ref={mountRef} style={{ width: "100%", height: 420, borderRadius: 12, overflow: "hidden", background: "#1a2235" }} />
      <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", margin: "8px 0" }}>Drag to orbit, scroll to zoom</p>
      {play.data.frames.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {play.data.frames.map((_, i) => (
            <button key={i} onClick={() => setFrameIdx(i)} style={{ padding: "6px 10px", border: i === frameIdx ? "2px solid var(--gold)" : "1px solid var(--border)" }}>
              Step {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
