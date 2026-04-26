/**
 * Three.js-based 3D model viewer component
 *
 * Supports MD2 (Quake 2), MD5 (Doom 3), ASE (3ds Max), OBJ, and GLTF/GLB formats
 * Features: orbit controls, animation playback, auto-sizing
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MD2Loader } from "three/addons/loaders/MD2Loader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MD5Loader } from "~/lib/MD5Loader";
import { ASELoader } from "~/lib/ASELoader";

type ModelFormat = "md2" | "md5mesh" | "ase" | "obj" | "gltf" | "glb";

interface AnimationInfo {
  clips: THREE.AnimationClip[];
  currentIndex: number;
  isPlaying: boolean;
}

/**
 * Self-contained Three.js scene for model viewing
 * Manages its own lifecycle independent of React
 */
class ModelScene {
  private container: HTMLElement;
  private height: number;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private animationFrameId: number | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private resizeObserver: ResizeObserver;

  public clips: THREE.AnimationClip[] = [];
  public currentClipIndex = 0;
  public isPlaying = true;

  public onAnimationChange?: (info: AnimationInfo) => void;
  public onLoadStart?: () => void;
  public onLoadComplete?: () => void;
  public onLoadError?: (error: string) => void;

  constructor(container: HTMLElement, height: number) {
    this.container = container;
    this.height = height;
    this.clock = new THREE.Clock();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f5f5);

    // Camera - use container width or fallback to reasonable default
    const width = container.clientWidth || 800;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 50, 100);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 500;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    this.scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-50, 50, -50);
    this.scene.add(directionalLight2);

    // Grid
    const gridHelper = new THREE.GridHelper(200, 20, 0xcccccc, 0xe0e0e0);
    this.scene.add(gridHelper);

    // Handle resize via ResizeObserver
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0) {
          this.camera.aspect = newWidth / this.height;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(newWidth, this.height);
        }
      }
    });
    this.resizeObserver.observe(container);

    // Start render loop
    this.animate();
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(delta);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private fitModelToView(object: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center the model
    object.position.sub(center);

    // Scale to fit
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale = 50 / maxDim;
      object.scale.multiplyScalar(scale);
    }

    // Position camera
    this.camera.position.set(0, 30, 80);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private setupAnimations(clips: THREE.AnimationClip[], target: THREE.Object3D) {
    if (clips.length === 0) return;

    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(target);

    // Play first animation
    this.currentAction = this.mixer.clipAction(clips[0]);
    this.currentAction.play();
    this.currentClipIndex = 0;
    this.isPlaying = true;

    this.notifyAnimationChange();
  }

  private notifyAnimationChange() {
    this.onAnimationChange?.({
      clips: this.clips,
      currentIndex: this.currentClipIndex,
      isPlaying: this.isPlaying,
    });
  }

  async loadModel(
    url: string,
    format: ModelFormat,
    textureUrl?: string,
    mtlUrl?: string,
    animUrls?: string[],
  ) {
    this.onLoadStart?.();

    // Clear previous model
    this.clearModel();

    try {
      switch (format) {
        case "md2":
          await this.loadMD2(url, textureUrl);
          break;
        case "md5mesh":
          await this.loadMD5(url, textureUrl, animUrls);
          break;
        case "ase":
          await this.loadASE(url, textureUrl);
          break;
        case "obj":
          await this.loadOBJ(url, textureUrl, mtlUrl);
          break;
        case "gltf":
        case "glb":
          await this.loadGLTF(url);
          break;
      }
      this.onLoadComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load model";
      console.error("Model load error:", err);
      this.onLoadError?.(message);
    }
  }

  private loadMD2(url: string, textureUrl?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new MD2Loader();

      loader.load(
        url,
        (geometry) => {
          let material: THREE.Material;

          if (textureUrl) {
            const texture = new THREE.TextureLoader().load(textureUrl);
            texture.colorSpace = THREE.SRGBColorSpace;
            material = new THREE.MeshLambertMaterial({ map: texture });
          } else {
            material = new THREE.MeshLambertMaterial({
              color: 0x888888,
              flatShading: true,
            });
          }

          const mesh = new THREE.Mesh(geometry, material);
          this.scene.add(mesh);
          this.fitModelToView(mesh);

          // MD2 animations are attached to geometry
          const geomWithAnims = geometry as THREE.BufferGeometry & {
            animations?: THREE.AnimationClip[];
          };
          if (geomWithAnims.animations) {
            this.setupAnimations(geomWithAnims.animations, mesh);
          }

          resolve();
        },
        undefined,
        (err) => reject(err),
      );
    });
  }

  private async loadMD5(url: string, textureUrl?: string, animUrls?: string[]): Promise<void> {
    const loader = new MD5Loader();

    // Load mesh
    const { mesh, skeleton } = await loader.loadMesh(url, textureUrl);
    this.scene.add(mesh);
    this.fitModelToView(mesh);

    // Load animations if provided
    if (animUrls && animUrls.length > 0) {
      const clips: THREE.AnimationClip[] = [];

      for (const animUrl of animUrls) {
        try {
          const clip = await loader.loadAnim(animUrl, skeleton);
          clips.push(clip);
        } catch (err) {
          console.warn(`Failed to load animation ${animUrl}:`, err);
        }
      }

      if (clips.length > 0) {
        this.setupAnimations(clips, mesh);
      }
    }
  }

  private async loadASE(url: string, textureUrl?: string): Promise<void> {
    const loader = new ASELoader();
    const group = await loader.load(url, textureUrl);
    this.scene.add(group);
    this.fitModelToView(group);
  }

  private loadOBJ(url: string, textureUrl?: string, mtlUrl?: string): Promise<void> {
    return new Promise((resolve, reject) => {
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
              const texture = new THREE.TextureLoader().load(textureUrl);
              texture.colorSpace = THREE.SRGBColorSpace;

              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = new THREE.MeshLambertMaterial({ map: texture });
                }
              });
            } else if (!mtlUrl) {
              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = new THREE.MeshLambertMaterial({
                    color: 0x888888,
                    flatShading: true,
                  });
                }
              });
            }

            this.scene.add(object);
            this.fitModelToView(object);
            resolve();
          },
          undefined,
          (err) => reject(err),
        );
      };

      if (mtlUrl) {
        const mtlLoader = new MTLLoader();
        const mtlPath = mtlUrl.substring(0, mtlUrl.lastIndexOf("/") + 1);
        mtlLoader.setPath(mtlPath);

        mtlLoader.load(
          mtlUrl.substring(mtlUrl.lastIndexOf("/") + 1),
          (materials) => loadWithMaterial(materials),
          undefined,
          () => {
            console.warn("Failed to load MTL, continuing without materials");
            loadWithMaterial();
          },
        );
      } else {
        loadWithMaterial();
      }
    });
  }

  private loadGLTF(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();

      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          this.scene.add(model);
          this.fitModelToView(model);

          if (gltf.animations && gltf.animations.length > 0) {
            this.setupAnimations(gltf.animations, model);
          }

          resolve();
        },
        undefined,
        (err) => reject(err),
      );
    });
  }

  private clearModel() {
    // Stop animations
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.currentAction = null;
    this.clips = [];
    this.currentClipIndex = 0;

    // Remove meshes (keep lights and grid)
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && !(child instanceof THREE.GridHelper)) {
        toRemove.push(child);
      }
      if (child instanceof THREE.Group) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((obj) => {
      if (obj.parent === this.scene) {
        this.scene.remove(obj);
      }
    });
  }

  playAnimation(index: number) {
    if (!this.mixer || index < 0 || index >= this.clips.length) return;

    if (this.currentAction) {
      this.currentAction.stop();
    }

    this.currentAction = this.mixer.clipAction(this.clips[index]);
    this.currentAction.play();
    this.currentClipIndex = index;
    this.isPlaying = true;

    this.notifyAnimationChange();
  }

  togglePlayPause() {
    if (!this.currentAction) return;

    this.currentAction.paused = !this.currentAction.paused;
    this.isPlaying = !this.currentAction.paused;

    this.notifyAnimationChange();
  }

  dispose() {
    // Stop animation loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Clean up observers
    this.resizeObserver.disconnect();

    // Dispose Three.js resources
    this.controls.dispose();
    this.renderer.dispose();

    // Remove canvas
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

// ============================================================================
// React Component (thin wrapper)
// ============================================================================

interface ModelViewerProps {
  modelUrl: string;
  textureUrl?: string;
  mtlUrl?: string;
  /** Animation URLs for MD5 format */
  animUrls?: string[];
  format: ModelFormat;
  height?: number;
}

export function ModelViewer({
  modelUrl,
  textureUrl,
  mtlUrl,
  animUrls,
  format,
  height = 400,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ModelScene | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animationInfo, setAnimationInfo] = useState<AnimationInfo | null>(null);

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new ModelScene(containerRef.current, height);
    sceneRef.current = scene;

    // Wire up callbacks
    scene.onLoadStart = () => {
      setLoading(true);
      setError(null);
    };
    scene.onLoadComplete = () => setLoading(false);
    scene.onLoadError = (err) => {
      setError(err);
      setLoading(false);
    };
    scene.onAnimationChange = setAnimationInfo;

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [height]);

  // Load model when URL/format changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    scene.loadModel(modelUrl, format, textureUrl, mtlUrl, animUrls);
  }, [modelUrl, format, textureUrl, mtlUrl, animUrls]);

  const handlePlayAnimation = (index: number) => {
    sceneRef.current?.playAnimation(index);
  };

  const handleTogglePlayPause = () => {
    sceneRef.current?.togglePlayPause();
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full bg-bg-hover overflow-hidden"
        style={{ height: `${height}px` }}
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[rgba(245,245,245,0.9)]">
          <div className="text-center text-text-muted">
            <div className="text-2xl mb-2">Loading model...</div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[rgba(245,245,245,0.9)]">
          <div className="text-center text-danger">
            <div className="text-2xl mb-2">Failed to load model</div>
            <div className="text-sm">{error}</div>
          </div>
        </div>
      )}

      {/* Animation controls */}
      {!loading && !error && animationInfo && animationInfo.clips.length > 0 && (
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center gap-2 p-2 bg-[rgba(255,255,255,0.9)] text-[0.8125rem]">
          <button
            onClick={handleTogglePlayPause}
            className="btn btn-sm font-mono border-border-light"
          >
            {animationInfo.isPlaying ? "||" : ">"}
          </button>

          <select
            value={animationInfo.currentIndex}
            onChange={(e) => handlePlayAnimation(parseInt(e.target.value))}
            className="input flex-1 p-1 text-[0.8125rem]"
          >
            {animationInfo.clips.map((clip, index) => (
              <option key={index} value={index}>
                {clip.name || `Animation ${index + 1}`}
              </option>
            ))}
          </select>

          <span className="text-text-muted text-xs">
            {animationInfo.clips.length} animation{animationInfo.clips.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Controls hint */}
      {!loading && !error && (
        <div className="absolute top-2.5 right-2.5 px-2 py-1 bg-[rgba(255,255,255,0.8)] text-[0.6875rem] text-text-faint">
          Drag to rotate | Scroll to zoom
        </div>
      )}
    </div>
  );
}
