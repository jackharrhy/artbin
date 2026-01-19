/**
 * Three.js-based 3D model viewer component
 * 
 * Supports MD2 (Quake 2), OBJ, and GLTF/GLB formats
 * Features: orbit controls, animation playback for MD2, auto-sizing
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MD2Loader } from "three/addons/loaders/MD2Loader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

interface ModelViewerProps {
  /** URL to the model file */
  modelUrl: string;
  /** Optional URL to texture file (for MD2/OBJ) */
  textureUrl?: string;
  /** Optional URL to MTL file (for OBJ) */
  mtlUrl?: string;
  /** File extension to determine loader */
  format: "md2" | "obj" | "gltf" | "glb";
  /** Height of the viewer */
  height?: number;
}

interface AnimationState {
  clips: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  currentAction: THREE.AnimationAction | null;
  currentClipIndex: number;
  isPlaying: boolean;
}

export function ModelViewer({
  modelUrl,
  textureUrl,
  mtlUrl,
  format,
  height = 400,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animation, setAnimation] = useState<AnimationState>({
    clips: [],
    mixer: null,
    currentAction: null,
    currentClipIndex: 0,
    isPlaying: true,
  });

  // Animation control functions
  const playAnimation = useCallback((index: number) => {
    if (!animation.mixer || animation.clips.length === 0) return;
    
    // Stop current action
    if (animation.currentAction) {
      animation.currentAction.stop();
    }
    
    // Play new action
    const clip = animation.clips[index];
    const action = animation.mixer.clipAction(clip);
    action.play();
    
    setAnimation(prev => ({
      ...prev,
      currentAction: action,
      currentClipIndex: index,
      isPlaying: true,
    }));
  }, [animation.mixer, animation.clips, animation.currentAction]);

  const togglePlayPause = useCallback(() => {
    if (!animation.currentAction) return;
    
    if (animation.isPlaying) {
      animation.currentAction.paused = true;
    } else {
      animation.currentAction.paused = false;
    }
    
    setAnimation(prev => ({
      ...prev,
      isPlaying: !prev.isPlaying,
    }));
  }, [animation.currentAction, animation.isPlaying]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 50, 100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 10;
    controls.maxDistance = 500;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-50, 50, -50);
    scene.add(directionalLight2);

    // Grid helper (subtle)
    const gridHelper = new THREE.GridHelper(200, 20, 0xcccccc, 0xe0e0e0);
    scene.add(gridHelper);

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      
      const delta = clockRef.current.getDelta();
      
      // Update animation mixer
      if (animation.mixer) {
        animation.mixer.update(delta);
      }
      
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
    };
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [height]);

  // Update animation mixer in animation loop
  useEffect(() => {
    // Re-trigger animation loop update when mixer changes
  }, [animation.mixer]);

  // Load model
  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    setLoading(true);
    setError(null);

    // Helper to center and scale model
    const fitModelToView = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Center the model
      object.position.sub(center);
      
      // Scale to fit
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 50 / maxDim;
      object.scale.multiplyScalar(scale);
      
      // Position camera
      camera.position.set(0, 30, 80);
      controls.target.set(0, 0, 0);
      controls.update();
    };

    // Load based on format
    const loadModel = async () => {
      try {
        if (format === "md2") {
          await loadMD2(scene, modelUrl, textureUrl, fitModelToView);
        } else if (format === "obj") {
          await loadOBJ(scene, modelUrl, textureUrl, mtlUrl, fitModelToView);
        } else if (format === "gltf" || format === "glb") {
          await loadGLTF(scene, modelUrl, fitModelToView);
        }
        setLoading(false);
      } catch (err) {
        console.error("Failed to load model:", err);
        setError(err instanceof Error ? err.message : "Failed to load model");
        setLoading(false);
      }
    };

    loadModel();

    // Cleanup - remove model from scene
    return () => {
      // Remove all meshes except lights and grid
      const toRemove: THREE.Object3D[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
          if (!(child instanceof THREE.GridHelper)) {
            toRemove.push(child);
          }
        }
      });
      toRemove.forEach((obj) => {
        if (obj.parent === scene) {
          scene.remove(obj);
        }
      });
    };
  }, [modelUrl, textureUrl, mtlUrl, format]);

  // MD2 Loader
  const loadMD2 = async (
    scene: THREE.Scene,
    url: string,
    textureUrl: string | undefined,
    fitToView: (obj: THREE.Object3D) => void
  ) => {
    return new Promise<void>((resolve, reject) => {
      const loader = new MD2Loader();
      
      loader.load(
        url,
        (geometry) => {
          // Load texture if provided
          let material: THREE.Material;
          
          if (textureUrl) {
            const textureLoader = new THREE.TextureLoader();
            const texture = textureLoader.load(textureUrl);
            texture.colorSpace = THREE.SRGBColorSpace;
            material = new THREE.MeshLambertMaterial({ map: texture });
          } else {
            // Default material with vertex colors or flat shading
            material = new THREE.MeshLambertMaterial({ 
              color: 0x888888,
              flatShading: true,
            });
          }
          
          const mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          fitToView(mesh);
          
          // Set up animations if available
          // MD2Loader attaches animations to geometry
          const geometryWithAnims = geometry as THREE.BufferGeometry & { animations?: THREE.AnimationClip[] };
          if (geometryWithAnims.animations && geometryWithAnims.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(mesh);
            const clips = geometryWithAnims.animations;
            
            // Play first animation by default
            const action = mixer.clipAction(clips[0]);
            action.play();
            
            setAnimation({
              clips,
              mixer,
              currentAction: action,
              currentClipIndex: 0,
              isPlaying: true,
            });
            
            // Update animation in render loop
            const clock = clockRef.current;
            const updateAnimation = () => {
              const delta = clock.getDelta();
              mixer.update(delta);
            };
            
            // Store mixer for cleanup
            (mesh as any)._mixer = mixer;
            (mesh as any)._animationUpdate = updateAnimation;
          }
          
          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    });
  };

  // OBJ Loader
  const loadOBJ = async (
    scene: THREE.Scene,
    url: string,
    textureUrl: string | undefined,
    mtlUrl: string | undefined,
    fitToView: (obj: THREE.Object3D) => void
  ) => {
    return new Promise<void>((resolve, reject) => {
      const objLoader = new OBJLoader();
      
      const loadWithMaterial = (materials?: MTLLoader.MaterialCreator) => {
        if (materials) {
          materials.preload();
          objLoader.setMaterials(materials);
        }
        
        objLoader.load(
          url,
          (object) => {
            // Apply texture if provided and no MTL
            if (textureUrl && !mtlUrl) {
              const textureLoader = new THREE.TextureLoader();
              const texture = textureLoader.load(textureUrl);
              texture.colorSpace = THREE.SRGBColorSpace;
              
              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = new THREE.MeshLambertMaterial({ map: texture });
                }
              });
            } else if (!mtlUrl) {
              // Default material
              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = new THREE.MeshLambertMaterial({ 
                    color: 0x888888,
                    flatShading: true,
                  });
                }
              });
            }
            
            scene.add(object);
            fitToView(object);
            resolve();
          },
          undefined,
          (err) => reject(err)
        );
      };
      
      // Load MTL if provided
      if (mtlUrl) {
        const mtlLoader = new MTLLoader();
        // Set path for texture loading relative to MTL file
        const mtlPath = mtlUrl.substring(0, mtlUrl.lastIndexOf("/") + 1);
        mtlLoader.setPath(mtlPath);
        
        mtlLoader.load(
          mtlUrl.substring(mtlUrl.lastIndexOf("/") + 1),
          (materials) => loadWithMaterial(materials),
          undefined,
          () => {
            // MTL failed to load, continue without it
            console.warn("Failed to load MTL file, loading OBJ without materials");
            loadWithMaterial();
          }
        );
      } else {
        loadWithMaterial();
      }
    });
  };

  // GLTF Loader
  const loadGLTF = async (
    scene: THREE.Scene,
    url: string,
    fitToView: (obj: THREE.Object3D) => void
  ) => {
    return new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          scene.add(model);
          fitToView(model);
          
          // Set up animations if available
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            const clips = gltf.animations;
            
            // Play first animation by default
            const action = mixer.clipAction(clips[0]);
            action.play();
            
            setAnimation({
              clips,
              mixer,
              currentAction: action,
              currentClipIndex: 0,
              isPlaying: true,
            });
          }
          
          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    });
  };

  // Update animation mixer in render loop
  useEffect(() => {
    if (!animation.mixer || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    
    const mixer = animation.mixer;
    const clock = clockRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    
    let frameId: number | null = null;
    
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      
      const delta = clock.getDelta();
      mixer.update(delta);
      
      if (controls) {
        controls.update();
      }
      
      renderer.render(scene, camera);
    };
    
    // Cancel previous animation loop and start new one with mixer
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animate();
    if (frameId !== null) {
      animationFrameRef.current = frameId;
    }
    
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [animation.mixer]);

  return (
    <div style={{ position: "relative" }}>
      <div 
        ref={containerRef} 
        style={{ 
          width: "100%", 
          height: `${height}px`,
          background: "#f5f5f5",
          borderRadius: "4px",
          overflow: "hidden",
        }} 
      />
      
      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(245, 245, 245, 0.9)",
        }}>
          <div style={{ textAlign: "center", color: "#666" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Loading model...</div>
          </div>
        </div>
      )}
      
      {/* Error overlay */}
      {error && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(245, 245, 245, 0.9)",
        }}>
          <div style={{ textAlign: "center", color: "#c00" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Failed to load model</div>
            <div style={{ fontSize: "0.875rem" }}>{error}</div>
          </div>
        </div>
      )}
      
      {/* Animation controls */}
      {!loading && !error && animation.clips.length > 0 && (
        <div style={{
          position: "absolute",
          bottom: "10px",
          left: "10px",
          right: "10px",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem",
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: "4px",
          fontSize: "0.8125rem",
        }}>
          <button
            onClick={togglePlayPause}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #ccc",
              background: "#fff",
              borderRadius: "3px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            {animation.isPlaying ? "||" : ">"}
          </button>
          
          <select
            value={animation.currentClipIndex}
            onChange={(e) => playAnimation(parseInt(e.target.value))}
            style={{
              flex: 1,
              padding: "0.25rem",
              border: "1px solid #ccc",
              borderRadius: "3px",
              fontSize: "0.8125rem",
            }}
          >
            {animation.clips.map((clip, index) => (
              <option key={index} value={index}>
                {clip.name || `Animation ${index + 1}`}
              </option>
            ))}
          </select>
          
          <span style={{ color: "#666", fontSize: "0.75rem" }}>
            {animation.clips.length} animation{animation.clips.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      
      {/* Controls hint */}
      {!loading && !error && (
        <div style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          padding: "0.25rem 0.5rem",
          background: "rgba(255, 255, 255, 0.8)",
          borderRadius: "3px",
          fontSize: "0.6875rem",
          color: "#888",
        }}>
          Drag to rotate | Scroll to zoom
        </div>
      )}
    </div>
  );
}
