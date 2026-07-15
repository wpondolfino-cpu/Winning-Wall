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
}

const FACE_COLORS = [0x378add, 0x639922, 0xd85a30, 0xd4537e, 0x7f77dd];
const SCALE = 40; // divides the 600x420 2D coordinate space down to world units
const toWorld = (x: number, y: number) => ({ x: (x - 300) / SCALE, z: (y - 210) / SCALE });

const PRESETS: { label: string; pos: [number, number, number] }[] = [
  { label: "Baseline", pos: [0, 4, 9] },
  { label: "Sideline", pos: [11, 4, 0] },
  { label: "Top-down", pos: [0, 13, 0.5] },
];

export default function Play3DViewer({ play, roster, onBack }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [isMobile] = useState(() => window.innerWidth < 768);

  // Mutable refs so the render loop (set up once) can read current props/state.
  const stateRef = useRef({ play, roster, frameIdx });
  stateRef.current = { play, roster, frameIdx };

  const playSignalRef = useRef(0);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const mount = mountRef.current!;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(...PRESETS[0].pos);
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
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 20), new THREE.MeshStandardMaterial({ color: 0xef9f27 }));
      rim.position.set(w.x, 2.0, w.z);
      rim.rotation.x = Math.PI / 2;
      scene.add(rim);
    });

    // Desktop: free orbit. Mobile: presets only (no drag control).
    let controls: OrbitControls | null = null;
    if (!isMobile) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.49; // don't let the camera dip below the floor
      controls.target.set(0, 0, 0);
    }

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

    function buildEntities(frame: PlayFrame, rosterMap: Record<string, RosterPlayer>) {
      clearEntities();
      frame.players.forEach((p, i) => {
        const color = FACE_COLORS[(p.num - 1 + 5) % 5];
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), new THREE.MeshStandardMaterial({ color }));
        body.position.y = 0.55;
        g.add(body);

        const avatarUrl = p.profile_id ? rosterMap[p.profile_id]?.avatar_url : null;
        if (avatarUrl) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
          sprite.position.y = 1.2;
          sprite.scale.set(0.5, 0.5, 0.5);
          textureLoader.load(avatarUrl, (tex) => { (sprite.material as THREE.SpriteMaterial).map = tex; (sprite.material as THREE.SpriteMaterial).needsUpdate = true; });
          g.add(sprite);
        } else {
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), new THREE.MeshStandardMaterial({ color }));
          head.position.y = 1.15;
          g.add(head);
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
      if (frame.ball) {
        const w = toWorld(frame.ball.x, frame.ball.y);
        ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), new THREE.MeshStandardMaterial({ color: 0xef9f27 }));
        ballMesh.position.set(w.x, 0.5, w.z);
        scene.add(ballMesh);
      }
    }

    buildEntities(stateRef.current.play.data.frames[stateRef.current.frameIdx], stateRef.current.roster);

    // Animation: tween from the current frame to the next whenever playSignalRef changes.
    let animStart: number | null = null;
    let animFromFrame: PlayFrame | null = null;
    let animToFrame: PlayFrame | null = null;
    let lastPlaySignal = 0;

    function maybeStartAnimation() {
      if (playSignalRef.current === lastPlaySignal) return;
      lastPlaySignal = playSignalRef.current;
      const { play: p, frameIdx: idx } = stateRef.current;
      const nextIdx = idx + 1;
      if (nextIdx >= p.data.frames.length) return;
      animFromFrame = p.data.frames[idx];
      animToFrame = p.data.frames[nextIdx];
      animStart = performance.now();
    }

    let raf = 0;
    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      maybeStartAnimation();
      if (animStart !== null && animFromFrame && animToFrame) {
        const t = Math.min(1, (now - animStart) / 1500);
        animFromFrame.players.forEach((fp, i) => {
          const tp = animToFrame!.players[i];
          if (!tp || !playerGroups[i]) return;
          const from = toWorld(fp.x, fp.y), to = toWorld(tp.x, tp.y);
          playerGroups[i].position.x = from.x + (to.x - from.x) * t;
          playerGroups[i].position.z = from.z + (to.z - from.z) * t;
        });
        if (t >= 1) {
          animStart = null;
          setFrameIdx((i) => i + 1);
        }
      }
      controls?.update();
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(tick);

    function handleResize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", handleResize);

    (mount as any)._rebuildForFrame = () => buildEntities(stateRef.current.play.data.frames[stateRef.current.frameIdx], stateRef.current.roster);
    (mount as any)._setPreset = (pos: [number, number, number]) => { camera.position.set(...pos); camera.lookAt(0, 0, 0); };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      controls?.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user picks a different beat manually (not via play animation), rebuild entities at that frame.
  useEffect(() => {
    (mountRef.current as any)?._rebuildForFrame?.();
  }, [frameIdx]);

  function watchPlay() {
    setFrameIdx(0);
    setTimeout(() => {
      playSignalRef.current += 1;
      forceRerender((n) => n + 1);
      // Kick off each subsequent beat automatically as frames advance.
      const advance = setInterval(() => {
        playSignalRef.current += 1;
      }, 1600);
      setTimeout(() => clearInterval(advance), 1600 * (play.data.frames.length + 1));
    }, 50);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={onBack} style={{ padding: "8px 14px" }}>← Back to 2D</button>
        <button onClick={watchPlay} className="coach-add-btn">▶ Watch play</button>
        {isMobile && (
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            {PRESETS.map((preset) => (
              <button key={preset.label} onClick={() => (mountRef.current as any)?._setPreset?.(preset.pos)} style={{ padding: "6px 10px", fontSize: 12 }}>
                {preset.label}
              </button>
            ))}
          </div>
        )}
        {!isMobile && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>Drag to orbit, scroll to zoom</span>}
      </div>
      <div ref={mountRef} style={{ width: "100%", height: 420, borderRadius: 12, overflow: "hidden", background: "#1a2235" }} />
      {play.data.frames.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {play.data.frames.map((_, i) => (
            <button key={i} onClick={() => setFrameIdx(i)} style={{ padding: "6px 10px", border: i === frameIdx ? "2px solid var(--gold)" : "1px solid var(--border)" }}>
              Beat {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
