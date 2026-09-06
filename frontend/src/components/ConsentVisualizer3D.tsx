import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ConsentVisualizer3DProps {
  consentGranted: boolean;
  audioLevel?: number;
  analyser?: AnalyserNode | null;
}

export default function ConsentVisualizer3D({
  consentGranted,
  audioLevel = 0,
  analyser = null,
}: ConsentVisualizer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef(consentGranted);
  const audioLevelRef = useRef(audioLevel);
  const analyserRef = useRef(analyser);

  consentRef.current = consentGranted;
  audioLevelRef.current = audioLevel;
  analyserRef.current = analyser;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 4.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    // --- Geometries & Meshes ---
    // 1. Central Quantum Core (Icosahedron)
    const coreGeo = new THREE.IcosahedronGeometry(1.0, 4);
    const coreBasePos = coreGeo.attributes.position.array.slice(0) as Float32Array;
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#00d4ff'),
      emissive: new THREE.Color('#002b3d'),
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.85,
      wireframe: false,
      flatShading: true,
      transparent: true,
      opacity: 0.88,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // 2. Outer Wireframe Cage (Dodecahedron)
    const cageGeo = new THREE.DodecahedronGeometry(1.35, 1);
    const cageMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#00d4ff'),
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    const cageMesh = new THREE.Mesh(cageGeo, cageMat);
    scene.add(cageMesh);

    // 3. Orbital Concentric Rings
    const ringGeo1 = new THREE.TorusGeometry(1.65, 0.015, 16, 100);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#00ff9c'),
      transparent: true,
      opacity: 0.4,
    });
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
    ring1.rotation.x = Math.PI / 3;
    scene.add(ring1);

    const ringGeo2 = new THREE.TorusGeometry(1.9, 0.012, 16, 100);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#00d4ff'),
      transparent: true,
      opacity: 0.3,
    });
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
    ring2.rotation.y = Math.PI / 4;
    ring2.rotation.x = -Math.PI / 6;
    scene.add(ring2);

    // 4. Ambient Particle Matrix / Swarm
    const particleCount = 280;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleScales = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 1.6 + Math.random() * 1.4;
      particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      particlePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      particlePositions[i * 3 + 2] = r * Math.cos(phi);
      particleScales[i] = Math.random() * 0.5 + 0.5;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: new THREE.Color('#00d4ff'),
      size: 0.045,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x00d4ff, 35, 10);
    cyanLight.position.set(3, 3, 3);
    scene.add(cyanLight);

    const mintLight = new THREE.PointLight(0x00ff9c, 25, 10);
    mintLight.position.set(-3, -2, 2);
    scene.add(mintLight);

    // --- Mouse Parallax Tracker ---
    let targetMouseX = 0;
    let targetMouseY = 0;
    let currentMouseX = 0;
    let currentMouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetMouseX = x * 0.6;
      targetMouseY = y * 0.4;
    };
    el.addEventListener('mousemove', handleMouseMove);

    // --- Resize Observer ---
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

    // --- Colors to interpolate ---
    const standbyColor = new THREE.Color('#00d4ff');
    const standbyEmissive = new THREE.Color('#002636');
    const grantedColor = new THREE.Color('#00ff9c');
    const grantedEmissive = new THREE.Color('#003820');

    const currentColor = standbyColor.clone();
    const currentEmissive = standbyEmissive.clone();

    // --- Animation Loop ---
    let raf = 0;
    let lastTime = performance.now();
    const freqData = new Uint8Array(256);
    let smoothAudio = 0;

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Mouse smoothing
      currentMouseX += (targetMouseX - currentMouseX) * dt * 4;
      currentMouseY += (targetMouseY - currentMouseY) * dt * 4;
      camera.position.x = currentMouseX;
      camera.position.y = currentMouseY;
      camera.lookAt(0, 0, 0);

      // Audio measurement
      let audioVal = audioLevelRef.current;
      const a = analyserRef.current;
      if (a) {
        a.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += freqData[i];
        audioVal = Math.max(audioVal, sum / 32 / 255);
      }
      smoothAudio += (audioVal - smoothAudio) * dt * 8;

      // Consent color interpolation
      const isGranted = consentRef.current;
      const targetColor = isGranted ? grantedColor : standbyColor;
      const targetEmissive = isGranted ? grantedEmissive : standbyEmissive;
      currentColor.lerp(targetColor, dt * 4);
      currentEmissive.lerp(targetEmissive, dt * 4);

      coreMat.color.copy(currentColor);
      coreMat.emissive.copy(currentEmissive);
      cageMat.color.copy(currentColor);
      particleMat.color.copy(currentColor);
      ringMat1.color.copy(isGranted ? grantedColor : standbyColor);

      // Rotations
      const speedMult = isGranted ? 1.8 : 1.0;
      coreMesh.rotation.y += dt * 0.35 * speedMult;
      coreMesh.rotation.x += dt * 0.15 * speedMult;

      cageMesh.rotation.y -= dt * 0.2 * speedMult;
      cageMesh.rotation.z += dt * 0.1 * speedMult;

      ring1.rotation.z += dt * 0.4 * speedMult;
      ring2.rotation.z -= dt * 0.3 * speedMult;
      particles.rotation.y += dt * 0.08;

      // Mesh Vertex displacement with audio & idle organic wave
      const pos = coreGeo.attributes.position;
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        const bx = coreBasePos[ix];
        const by = coreBasePos[ix + 1];
        const bz = coreBasePos[ix + 2];
        const len = Math.hypot(bx, by, bz) || 1;

        const wave = Math.sin(now * 0.003 + bx * 2 + by * 2) * 0.05;
        const audioDisplace = smoothAudio * 0.38 * Math.sin(i * 3 + now * 0.01);
        const scale = 1.0 + wave + audioDisplace + (isGranted ? 0.06 * Math.sin(now * 0.005) : 0);

        pos.array[ix] = (bx / len) * scale;
        pos.array[ix + 1] = (by / len) * scale;
        pos.array[ix + 2] = (bz / len) * scale;
      }
      pos.needsUpdate = true;
      coreGeo.computeVertexNormals();

      // Ring pulse scale with audio
      const ringScale = 1.0 + smoothAudio * 0.25;
      ring1.scale.set(ringScale, ringScale, ringScale);
      ring2.scale.set(1.0 + smoothAudio * 0.15, 1.0 + smoothAudio * 0.15, 1.0 + smoothAudio * 0.15);

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousemove', handleMouseMove);
      ro.disconnect();
      renderer.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      cageGeo.dispose();
      cageMat.dispose();
      ringGeo1.dispose();
      ringMat1.dispose();
      ringGeo2.dispose();
      ringMat2.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full min-h-[340px] overflow-hidden rounded-2xl bg-gradient-to-b from-slate-950/80 via-slate-900/50 to-slate-950/80 border border-white/10 shadow-[inset_0_0_50px_rgba(0,0,0,0.8)] flex items-center justify-center">
      <div ref={mountRef} className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Cybernetic HUD overlays */}
      <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2 font-mono text-[10px] tracking-wider text-cyan/70">
        <span className="inline-block h-2 w-2 rounded-full bg-cyan shadow-[0_0_8px_#00d4ff] animate-ping" />
        <span>THREE.JS WEBGL // INTEGRITY LATTICE</span>
      </div>

      <div className="pointer-events-none absolute top-4 right-4 flex items-center gap-1.5 font-mono text-[10px] text-white/50">
        <span className="rounded bg-black/40 px-2 py-0.5 border border-white/10">
          NODE: {consentGranted ? 'VERIFIED' : 'AWAITING AUTH'}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-center justify-between font-mono text-[10px] text-white/40">
        <span>INTERACTIVE: MOVE CURSOR TO ROTATE</span>
        <span className={consentGranted ? 'text-mint font-semibold' : 'text-cyan'}>
          {consentGranted ? '● PROTOCOL SYNCHRONIZED' : '○ VOICE ENCLAVE IDLE'}
        </span>
      </div>
    </div>
  );
}
