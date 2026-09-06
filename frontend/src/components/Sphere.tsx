import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Descriptor = 'measured' | 'steady' | 'fast' | null;

const PALETTE: Record<string, THREE.Color> = {
  idle: new THREE.Color('#1e3a5f'),
  measured: new THREE.Color('#00ff9c'),
  steady: new THREE.Color('#00d4ff'),
  fast: new THREE.Color('#ffb800'),
};

/**
 * Enhanced Real-time WebGL audio sphere.
 * Vertex displacement follows the live FFT; colour follows pace descriptor.
 * Features ambient floating particles, orbital aura ring, and dynamic mouse tracking.
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
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 4.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    // 1. Core Sphere Geometry
    const geo = new THREE.IcosahedronGeometry(1.22, 14);
    const basePositions = geo.attributes.position.array.slice(0) as Float32Array;
    const nVerts = geo.attributes.position.count;

    const mat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.idle,
      emissive: PALETTE.idle,
      emissiveIntensity: 0.45,
      metalness: 0.35,
      roughness: 0.25,
      flatShading: true,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // 2. Outer Wireframe Shell
    const shellGeo = new THREE.IcosahedronGeometry(1.36, 6);
    const shellMat = new THREE.MeshBasicMaterial({
      color: PALETTE.idle,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    scene.add(shell);

    // 3. Floating Orbital Particle Ring
    const pCount = 140;
    const pPositions = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const angle = (i / pCount) * Math.PI * 2;
      const radius = 1.7 + (Math.random() - 0.5) * 0.3;
      pPositions[i * 3] = Math.cos(angle) * radius;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      pPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({
      color: PALETTE.idle,
      size: 0.04,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const particleRing = new THREE.Points(pGeo, pMat);
    particleRing.rotation.x = Math.PI / 4;
    scene.add(particleRing);

    // 4. Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.PointLight(0xffffff, 45, 20);
    key.position.set(3, 4, 5);
    scene.add(key);

    const rimLight = new THREE.PointLight(0x00d4ff, 25, 15);
    rimLight.position.set(-3, -3, -2);
    scene.add(rimLight);

    const freq = new Uint8Array(512);
    const target = PALETTE.idle.clone();
    let raf = 0;
    let tPrev = performance.now();
    let smooth = 0;

    // Mouse Tracking
    let targetMouseX = 0;
    let targetMouseY = 0;
    let mouseX = 0;
    let mouseY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetMouseX = x * 0.4;
      targetMouseY = y * 0.3;
    };
    el.addEventListener('mousemove', onMouseMove);

    const resize = () => {
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const pos = geo.attributes.position;

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - tPrev) / 1000);
      tPrev = now;

      // Mouse Parallax
      mouseX += (targetMouseX - mouseX) * dt * 4;
      mouseY += (targetMouseY - mouseY) * dt * 4;
      camera.position.x = mouseX + Math.sin(now / 6000) * 0.3;
      camera.position.y = mouseY;
      camera.lookAt(0, 0, 0);

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
        const disp = 1 + smooth * 0.4 + bin * smooth * 0.6 + Math.sin(now / 600 + i) * 0.012;
        pos.array[ix] = (nx / len) * 1.22 * disp;
        pos.array[ix + 1] = (ny / len) * 1.22 * disp;
        pos.array[ix + 2] = (nz / len) * 1.22 * disp;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      const want = liveRef.current ? PALETTE[descRef.current ?? 'steady'] ?? PALETTE.steady : PALETTE.idle;
      target.lerp(want, Math.min(1, dt * 3));
      mat.color.copy(target);
      mat.emissive.copy(target);
      mat.emissiveIntensity = 0.35 + smooth * 1.1;
      (shell.material as THREE.MeshBasicMaterial).color.copy(target);
      (particleRing.material as THREE.PointsMaterial).color.copy(target);

      mesh.rotation.y += dt * 0.22;
      mesh.rotation.x = Math.sin(now / 4000) * 0.15;
      shell.rotation.y -= dt * 0.08;
      particleRing.rotation.y += dt * 0.15;
      particleRing.scale.set(1 + smooth * 0.3, 1 + smooth * 0.3, 1 + smooth * 0.3);

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousemove', onMouseMove);
      ro.disconnect();
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      shellGeo.dispose();
      shellMat.dispose();
      pGeo.dispose();
      pMat.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mount} className="h-full w-full cursor-grab active:cursor-grabbing" />;
}
