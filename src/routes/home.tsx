import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "artbin - texture & asset repository" },
    { name: "description", content: "Find textures for gamedev. Upload, search, moodboard." },
  ];
}

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b-4 border-fuchsia p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-3xl font-bold">
            <span className="text-fuchsia">*</span>
            <span className="text-aqua">~</span>
            <span className="text-lime"> artbin </span>
            <span className="text-aqua">~</span>
            <span className="text-fuchsia">*</span>
          </h1>
          <nav className="flex gap-4">
            <a href="/login" className="btn">Login</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-6xl mx-auto p-8">
        <div className="text-center mb-8">
          <div className="marquee mb-4">
            <span className="marquee-content text-xl">
              *** WELCOME TO ARTBIN - YOUR TEXTURE & GAME ASSET REPOSITORY ***
            </span>
          </div>
          <hr className="hr-rainbow my-6" />
        </div>

        {/* Main Content Box */}
        <div className="box-retro mb-8">
          <h2 className="text-2xl font-bold text-lime mb-4 text-center">
            :: What is artbin? ::
          </h2>
          <p className="mb-4">
            artbin is a <span className="text-yellow">texture</span> and{" "}
            <span className="text-aqua">game asset</span> repository for finding,
            uploading, and moodboarding visual resources for game development.
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li><span className="text-lime">Upload</span> textures and organize them into collections</li>
            <li><span className="text-aqua">Search</span> by tags like seamless, wood, metal, 90s, pixel...</li>
            <li><span className="text-yellow">Moodboard</span> with friends to find your game's vibe</li>
            <li><span className="text-fuchsia">Extract</span> textures from BSP files and game archives</li>
          </ul>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="box-retro border-lime">
            <h3 className="text-xl font-bold text-lime mb-2">Textures</h3>
            <p className="text-sm">
              Browse thousands of textures. Filter by material, style, resolution.
              Upload your own collections.
            </p>
          </div>
          <div className="box-retro border-aqua">
            <h3 className="text-xl font-bold text-aqua mb-2">Moodboards</h3>
            <p className="text-sm">
              Create shared boards with textures, images, notes. 
              Collaborate with your team to find the vibe.
            </p>
          </div>
          <div className="box-retro border-yellow">
            <h3 className="text-xl font-bold text-yellow mb-2">Game Assets</h3>
            <p className="text-sm">
              Models, sprites, shaders. Extract textures from Quake BSPs.
              View models in the browser.
            </p>
          </div>
        </div>

        {/* Login Prompt */}
        <div className="box-highlight text-center">
          <h3 className="text-2xl font-bold text-white mb-4">
            Ready to explore?
          </h3>
          <p className="mb-4">
            artbin is invite-only. Login to browse the collection or ask a friend for an invite.
          </p>
          <a href="/login" className="btn btn-primary text-lg">
            Enter artbin
          </a>
        </div>

        {/* Sample Tags */}
        <div className="mt-8 text-center">
          <h4 className="text-lg font-bold mb-4">Popular Tags:</h4>
          <div className="flex flex-wrap justify-center gap-2">
            <span className="tag tag-seamless">seamless</span>
            <span className="tag tag-wood">wood</span>
            <span className="tag tag-metal">metal</span>
            <span className="tag tag-stone">stone</span>
            <span className="tag tag-fabric">fabric</span>
            <span className="tag tag-water">water</span>
            <span className="tag tag-fire">fire</span>
            <span className="tag tag-90s">90s</span>
            <span className="tag tag-pixel">pixel</span>
          </div>
        </div>

        <hr className="hr-dashed my-8" />

        {/* Footer */}
        <footer className="text-center text-sm">
          <p>
            Inspired by{" "}
            <a href="https://textures.neocities.org/" target="_blank" rel="noopener noreferrer">
              TextureTown
            </a>
          </p>
          <p className="mt-2 text-gray">
            artbin v0.1 | made with love for gamedev
          </p>
        </footer>
      </main>
    </div>
  );
}
