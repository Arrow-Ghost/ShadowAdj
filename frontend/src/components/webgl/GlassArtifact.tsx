import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, Float, MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Normalised 0..1 scroll progress of the document. */
function useScrollProgress() {
  const ref = useRef(0);
  useEffect(() => {
    const on = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      ref.current = h > 0 ? Math.min(1, window.scrollY / h) : 0;
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return ref;
}

function Artifact({ reduced, mobile }: { reduced: boolean; mobile: boolean }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const scroll = useScrollProgress();
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const on = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    const s = scroll.current;
    // Scroll drives the primary rotation; time adds a slow idle drift.
    const targetY = s * Math.PI * 2.4 + (reduced ? 0 : t * 0.12);
    const targetX = -0.35 + s * 0.6 + (reduced ? 0 : Math.sin(t * 0.4) * 0.05);
    group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, delta * 3);
    group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, delta * 3);
    if (!reduced) {
      group.current.position.x += (pointer.current.x * 0.25 - group.current.position.x) * 0.04;
      group.current.position.y += (-pointer.current.y * 0.2 - group.current.position.y) * 0.04;
    }
    if (core.current) core.current.rotation.z = -t * 0.2;
    // gentle "separation" as the user scrolls the hero
    const spread = 1 + s * 0.15;
    group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, spread, 0.1));
  });

  const shardGeo = useMemo(() => new THREE.TetrahedronGeometry(0.16, 0), []);
  const shards = useMemo(
    () =>
      Array.from({ length: mobile ? 5 : 11 }, (_, i) => ({
        pos: [
          Math.cos((i / 11) * Math.PI * 2) * (1.7 + (i % 3) * 0.25),
          Math.sin((i / 7) * Math.PI * 2) * 1.3,
          Math.sin((i / 11) * Math.PI * 2) * (1.6 + (i % 2) * 0.4),
        ] as [number, number, number],
        rot: [i * 0.7, i * 1.1, i * 0.4] as [number, number, number],
        speed: 0.2 + (i % 4) * 0.12,
      })),
    [mobile],
  );

  return (
    <group ref={group} dispose={null}>
      {/* faceted glass core */}
      <mesh castShadow>
        <icosahedronGeometry args={[1.35, 0]} />
        {mobile ? (
          <meshPhysicalMaterial
            color="#cfe6e2"
            roughness={0.12}
            metalness={0}
            transmission={0.6}
            thickness={1.4}
            ior={1.35}
            clearcoat={1}
            clearcoatRoughness={0.2}
            transparent
            opacity={0.92}
          />
        ) : (
          <MeshTransmissionMaterial
            samples={6}
            resolution={256}
            thickness={1.6}
            roughness={0.14}
            anisotropy={0.3}
            chromaticAberration={0.06}
            distortion={0.2}
            distortionScale={0.4}
            temporalDistortion={reduced ? 0 : 0.12}
            ior={1.4}
            color="#dbe9e6"
            background={new THREE.Color('#0b0e13')}
          />
        )}
      </mesh>

      {/* inner armature — reads as internal structure through the glass */}
      <mesh ref={core} scale={0.62}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color="#6fb4ac" wireframe transparent opacity={0.28} />
      </mesh>
      <mesh scale={0.28}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#8497ae" emissive="#3a4a5e" emissiveIntensity={0.6} roughness={0.4} />
      </mesh>

      {/* drifting shards */}
      {shards.map((sh, i) => (
        <Float key={i} speed={reduced ? 0 : sh.speed} rotationIntensity={reduced ? 0 : 0.8} floatIntensity={reduced ? 0 : 0.8}>
          <mesh geometry={shardGeo} position={sh.pos} rotation={sh.rot}>
            <meshPhysicalMaterial
              color="#c8d6dd"
              roughness={0.1}
              transmission={0.7}
              thickness={0.5}
              ior={1.3}
              transparent
              opacity={0.75}
            />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

export default function GlassArtifact() {
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setReduced(prefersReduced());
    setMobile(window.matchMedia('(max-width: 768px)').matches || navigator.hardwareConcurrency <= 4);
    // Defer WebGL init a beat so it never blocks first paint / LCP.
    const id = window.setTimeout(() => setReady(true), 120);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="relative aspect-square w-full max-w-[560px]">
      {/* soft base glow behind the object */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[12%] rounded-full bg-teal/10 blur-3xl animate-breathe"
      />
      {ready && (
        <Canvas
          camera={{ position: [0, 0, 5.4], fov: 42 }}
          dpr={[1, mobile ? 1.3 : 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.4} />
          <directionalLight position={[4, 6, 5]} intensity={1.1} />
          <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#8497ae" />
          <Artifact reduced={reduced} mobile={mobile} />
          <Environment resolution={mobile ? 128 : 256} frames={reduced ? 1 : Infinity}>
            <group rotation={[0, 0, 0]}>
              <Lightformer form="rect" intensity={2} position={[3, 3, 4]} scale={[6, 6, 1]} color="#eef4f3" />
              <Lightformer form="rect" intensity={1.2} position={[-4, -2, -3]} scale={[8, 4, 1]} color="#7f93ab" />
              <Lightformer form="circle" intensity={1.6} position={[0, 4, -6]} scale={[4, 4, 1]} color="#6fb4ac" />
            </group>
          </Environment>
        </Canvas>
      )}
      {!ready && (
        <div className="absolute inset-[16%] rounded-[2rem] border border-white/10 bg-white/[0.02] backdrop-blur-sm" />
      )}
    </div>
  );
}
