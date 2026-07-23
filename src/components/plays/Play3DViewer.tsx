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
import { Play, RosterPlayer, PlayFrame, PlayAction, resolvePassEndpoint, playerActionSequence, localActionProgress } from "../../lib/plays";
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
  const [speed, setSpeed] = useState(1);

  // Mutable refs so the render loop (set up once) can read current props/state.
  const stateRef = useRef({ play, roster, frameIdx, selfOverride, speed });
  stateRef.current = { play, roster, frameIdx, selfOverride, speed };

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
    let coneGroups: THREE.Group[] = [];
    let ballMesh: THREE.Mesh | null = null;
    const textureLoader = new THREE.TextureLoader();

    function clearEntities() {
      [...playerGroups, ...defenderGroups, ...coneGroups].forEach((g) => scene.remove(g));
      if (ballMesh) scene.remove(ballMesh);
      playerGroups = []; defenderGroups = []; coneGroups = []; ballMesh = null;
    }

    // Mirrors the 2D canvas's getBallPos — the ball follows whoever holds
    // it (by id) rather than relying only on its own stored x/y, which can
    // go stale if the holder was moved without the stored ball position
    // being touched.
    function getBallWorldPos(f: PlayFrame) {
      if (f.ballHolderId) {
        const holder = f.players.find((p) => p.id === f.ballHolderId);
        if (holder) {
          const w = toWorld(holder.x, holder.y);
          // Offset to the side, like the ball is in the player's hand —
          // dead-center on the holder's own coordinates put it inside their
          // (opaque) body, hiding it from view entirely.
          return { x: w.x + 0.38, z: w.z };
        }
      }
      return f.ball ? toWorld(f.ball.x, f.ball.y) : null;
    }

    // A number printed directly on the jersey (front and back), like a real
// uniform, instead of a floating badge near the head.
function makeJerseyNumberTexture(num: number, mirrored = false): THREE.CanvasTexture {
  const w = 64, h = 80;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  if (mirrored) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 3;
  ctx.font = "bold 56px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = String(num);
  ctx.strokeText(text, w / 2, h / 2 + 2);
  ctx.fillText(text, w / 2, h / 2 + 2);
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
          // Our own generated avatars are always .svg (see avatarConfigToFile)
          // and have the illustrated shoulders/collar starting at a known,
          // fixed point in the image — real uploaded photos have no such
          // predictable boundary, so only crop the ones we generated.
          const isBuiltAvatar = /\.svg(\?|$)/i.test(avatarUrl);
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
          sprite.position.y = isBuiltAvatar ? 1.35 : 1.2;
          sprite.scale.set(isBuiltAvatar ? 0.85 : 0.5, isBuiltAvatar ? 0.56 : 0.5, 0.5);
          textureLoader.load(
            avatarUrl,
            (tex) => {
              if (isBuiltAvatar) {
                // Keep only the top ~66% of the image (head/face/hair),
                // cutting off the built-in shoulders and collar so they
                // don't clash with the jersey color on the body below.
                tex.repeat.set(1, 0.66);
                tex.offset.set(0, 0.34);
              }
              (sprite.material as THREE.SpriteMaterial).map = tex;
              (sprite.material as THREE.SpriteMaterial).needsUpdate = true;
            },
            undefined,
            (err) => console.error("3D avatar texture failed to load:", avatarUrl, err)
          );
          g.add(sprite);
        } else {
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), new THREE.MeshStandardMaterial({ color }));
          head.position.y = 1.15;
          g.add(head);
        }

        const numberFront = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshBasicMaterial({ map: makeJerseyNumberTexture(p.num, false), transparent: true }));
        numberFront.position.set(0, 0.62, 0.281);
        g.add(numberFront);
        const numberBack = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshBasicMaterial({ map: makeJerseyNumberTexture(p.num, true), transparent: true }));
        numberBack.position.set(0, 0.62, -0.281);
        numberBack.rotation.y = Math.PI;
        g.add(numberBack);

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
      (frame.cones ?? []).forEach((c, i) => {
        const g = new THREE.Group();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 12), new THREE.MeshStandardMaterial({ color: 0xe2650f }));
        cone.position.y = 0.16;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xe2650f }));
        base.position.y = 0.025;
        g.add(base, cone);
        const w = toWorld(c.x, c.y);
        g.position.set(w.x, 0, w.z);
        scene.add(g);
        coneGroups[i] = g;
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
    // After a made shot, the ball drops from rim height to the floor over
    // this many ms instead of snapping there instantly when the next step
    // takes over.
    let fallStart: number | null = null;
    const FALL_DURATION = 550;
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

    function advanceBeat() {
      const nextIdx = stateRef.current.frameIdx + 1;
      setFrameIdx(nextIdx);
      stateRef.current = { ...stateRef.current, frameIdx: nextIdx };
      const more = isPlayingRef.current && beginNextBeat();
      if (!more) {
        animFromFrame = null; animToFrame = null; elapsed = 0;
        if (isPlayingRef.current) pause();
      }
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
      if (fallStart !== null) {
        const ft = Math.min(1, (now - fallStart) / FALL_DURATION);
        if (ballMesh) ballMesh.position.y = 2.0 + (0.5 - 2.0) * ft;
        if (ft >= 1) {
          fallStart = null;
          advanceBeat();
        }
      } else if (animFromFrame && animToFrame) {
        if (isPlayingRef.current) elapsed += dt;
        const t = Math.min(1, elapsed / (1500 / stateRef.current.speed));
        animFromFrame.players.forEach((fp, i) => {
          const tp = animToFrame!.players[i];
          if (!tp || !playerGroups[i]) return;
          const fullSeq = fp.id ? playerActionSequence(animFromFrame!, fp.id) : [];
          let x: number, z: number;
          if (fullSeq.length > 0) {
            // Figure out which of this player's actions is "active" right
            // now, then walk backward from there to find their most recent
            // movement (a non-movement action like a pass in between just
            // means they're standing still to make it, not gliding).
            const total = fullSeq.length;
            const activeIdx = Math.min(total - 1, Math.floor(t * total));
            let moveAction: PlayAction | undefined;
            let moveActionIdx = -1;
            for (let k = activeIdx; k >= 0; k--) {
              if (fullSeq[k].type === "move" || fullSeq[k].type === "dribble" || fullSeq[k].type === "screen") {
                moveAction = fullSeq[k]; moveActionIdx = k; break;
              }
            }
            if (moveAction && moveActionIdx === activeIdx) {
              // The active slot IS a movement — animate along it, following
              // its curve if it has one (see note above on curved routes).
              const localT = localActionProgress(t, moveAction, animFromFrame!);
              if (moveAction.curve) {
                const mt = 1 - localT;
                const w1 = toWorld(moveAction.x1, moveAction.y1), wc = toWorld(moveAction.curve.x, moveAction.curve.y), w2 = toWorld(moveAction.x2, moveAction.y2);
                x = mt * mt * w1.x + 2 * mt * localT * wc.x + localT * localT * w2.x;
                z = mt * mt * w1.z + 2 * mt * localT * wc.z + localT * localT * w2.z;
              } else {
                const from = toWorld(moveAction.x1, moveAction.y1), to = toWorld(moveAction.x2, moveAction.y2);
                x = from.x + (to.x - from.x) * localT;
                z = from.z + (to.z - from.z) * localT;
              }
            } else if (moveAction) {
              // The active slot is something else (e.g. a pass) that comes
              // after their last movement — hold at that movement's end.
              const w = toWorld(moveAction.x2, moveAction.y2);
              x = w.x; z = w.z;
            } else {
              // No movement has happened yet in their sequence — still at
              // their starting spot for this step.
              const w = toWorld(fp.x, fp.y);
              x = w.x; z = w.z;
            }
          } else {
            const from = toWorld(fp.x, fp.y), to = toWorld(tp.x, tp.y);
            x = from.x + (to.x - from.x) * t;
            z = from.z + (to.z - from.z) * t;
          }
          playerGroups[i].position.x = x;
          playerGroups[i].position.z = z;
          // A player being lobbed to jumps to meet the ball — timed the
          // same way as the ball's own arc, so they peak together, and
          // naturally back at floor level by the end of the beat.
          const lobCatch = fp.id ? animFromFrame!.actions.find((a) => a.type === "lob" && a.targetPlayerId === fp.id) : undefined;
          playerGroups[i].position.y = lobCatch ? Math.sin(t * Math.PI) * 1.3 : 0;
        });
        if (ballMesh) {
          const fromBall = getBallWorldPos(animFromFrame);
          const toBall = getBallWorldPos(animToFrame);
          if (fromBall && toBall) {
            const passAction = [...animFromFrame.actions].reverse().find((a) => a.type === "pass" && a.targetPlayerId && a.curve);
            const shotAction = [...animFromFrame.actions].reverse().find((a) => a.type === "shot" && a.curve);
            const lobAction = [...animFromFrame.actions].reverse().find((a) => a.type === "lob" && a.curve);
            if (passAction?.curve) {
              const mt = 1 - t;
              const target = resolvePassEndpoint(animFromFrame, passAction);
              const w1 = toWorld(passAction.x1, passAction.y1), wc = toWorld(passAction.curve.x, passAction.curve.y), w2 = toWorld(target.x, target.y);
              ballMesh.position.x = mt * mt * w1.x + 2 * mt * t * wc.x + t * t * w2.x;
              ballMesh.position.z = mt * mt * w1.z + 2 * mt * t * wc.z + t * t * w2.z;
              ballMesh.position.y = 0.5;
            } else if (shotAction?.curve) {
              const mt = 1 - t;
              const w1 = toWorld(shotAction.x1, shotAction.y1), wc = toWorld(shotAction.curve.x, shotAction.curve.y), w2 = toWorld(shotAction.x2, shotAction.y2);
              ballMesh.position.x = mt * mt * w1.x + 2 * mt * t * wc.x + t * t * w2.x;
              ballMesh.position.z = mt * mt * w1.z + 2 * mt * t * wc.z + t * t * w2.z;
              // A real shot goes up and comes back down into the rim,
              // rather than sliding flat across the floor like a pass.
              // Rises from roughly hand height, peaks well above the rim,
              // and arrives at rim height exactly when it reaches the
              // hoop's x/z position — the old formula came back down to
              // floor height by the time it got there, making it look like
              // it fell short instead of going through the rim.
              const startH = 1.4, rimH = 2.0, peakBump = 2.0;
              ballMesh.position.y = startH + (rimH - startH) * t + Math.sin(t * Math.PI) * peakBump;
            } else if (lobAction?.curve) {
              const mt = 1 - t;
              const w1 = toWorld(lobAction.x1, lobAction.y1), wc = toWorld(lobAction.curve.x, lobAction.curve.y), w2 = toWorld(lobAction.x2, lobAction.y2);
              ballMesh.position.x = mt * mt * w1.x + 2 * mt * t * wc.x + t * t * w2.x;
              ballMesh.position.z = mt * mt * w1.z + 2 * mt * t * wc.z + t * t * w2.z;
              // Higher, floatier arc than a shot — a lob needs to clear
              // defenders and give the receiver room to jump up and meet
              // it before it continues into the hoop.
              const startH = 1.5, rimH = 2.0, peakBump = 3.2;
              ballMesh.position.y = startH + (rimH - startH) * t + Math.sin(t * Math.PI) * peakBump;
            } else {
              ballMesh.position.x = fromBall.x + (toBall.x - fromBall.x) * t;
              ballMesh.position.z = fromBall.z + (toBall.z - fromBall.z) * t;
              ballMesh.position.y = 0.5;
            }
          }
        }
        if (t >= 1) {
          const hadShot = animFromFrame.actions.some((a) => a.type === "shot" || a.type === "lob");
          if (hadShot) {
            fallStart = now;
          } else {
            advanceBeat();
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
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ padding: "7px 8px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "inherit", outline: "none" }}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
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
