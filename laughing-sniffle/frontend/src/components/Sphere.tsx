import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Descriptor = 'measured' | 'steady' | 'fast' | null;

const PALETTE: Record<string, THREE.Color> = {
  idle: new THREE.Color('#2b4a63'),
  measured: new THREE.Color('#00ff9c'),
  steady: new THREE.Color('#00d4ff'),
  fast: new THREE.Color('#ffb800'),
};

/**
 * Real-time audio sphere. Vertex displacement follows the live FFT; colour
 * follows the *pace descriptor* (measured / steady / fast) — it is a reflection
 * of how someone is speaking, never a risk or suspicion indicator.
 */
export default function Sphere({
  analyser,
  descriptor,
  live,
}: {
  analyser: AnalyserNode | null;
  descriptor: Descriptor;
  live: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const analyserRef = useRef(analyser);
  const descRef = useRef<Descriptor>(descriptor);
  const liveRef = useRef(live);
  analyserRef.current = analyser;
  descRef.current = descriptor;
  liveRef.current = live;

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const geo = new THREE.IcosahedronGeometry(1.25, 14);
    const basePositions = geo.attributes.position.array.slice(0) as Float32Array;
    const nVerts = geo.attributes.position.count;

    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.idle,
      emissive: PALETTE.idle,
      emissiveIntensity: 0.35,
      metalness: 0.1,
      roughness: 0.35,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.32, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.idle, wireframe: true, transparent: true, opacity: 0.12 }),
    );
    scene.add(shell);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.PointLight(0xffffff, 40, 20);
    key.position.set(3, 4, 5);
    scene.add(key);

    const freq = new Uint8Array(512);
    const target = PALETTE.idle.clone();
    let raf = 0;
    let tPrev = performance.now();
    let smooth = 0;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const pos = geo.attributes.position;

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - tPrev) / 1000);
      tPrev = now;

      const a = analyserRef.current;
      let level = 0;
      if (a && liveRef.current) {
        a.getByteFrequencyData(freq);
        for (let i = 0; i < 64; i += 1) level += freq[i];
        level = level / 64 / 255;
      }
      smooth += (level - smooth) * Math.min(1, dt * 8);

      for (let i = 0; i < nVerts; i += 1) {
        const ix = i * 3;
        const nx = basePositions[ix];
        const ny = basePositions[ix + 1];
        const nz = basePositions[ix + 2];
        const len = Math.hypot(nx, ny, nz) || 1;
        const bin = freq[(i * 7) % 256] / 255 || 0;
        const disp = 1 + smooth * 0.35 + bin * smooth * 0.5 + Math.sin(now / 600 + i) * 0.01;
        pos.array[ix] = (nx / len) * 1.25 * disp;
        pos.array[ix + 1] = (ny / len) * 1.25 * disp;
        pos.array[ix + 2] = (nz / len) * 1.25 * disp;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      const want = liveRef.current ? PALETTE[descRef.current ?? 'steady'] ?? PALETTE.steady : PALETTE.idle;
      target.lerp(want, Math.min(1, dt * 3));
      mat.color.copy(target);
      mat.emissive.copy(target);
      mat.emissiveIntensity = 0.3 + smooth * 0.9;
      (shell.material as THREE.MeshBasicMaterial).color.copy(target);

      mesh.rotation.y += dt * 0.18;
      mesh.rotation.x = Math.sin(now / 4000) * 0.15;
      shell.rotation.y -= dt * 0.05;
      camera.position.x = Math.sin(now / 6000) * 0.5;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mount} className="h-full w-full" />;
}
