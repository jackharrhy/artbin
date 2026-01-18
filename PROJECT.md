# artbin

A texture and game asset repository for finding and uploading visual resources for game development.

**Inspiration:** [TextureTown](https://textures.neocities.org/) - study this site for UX patterns and as an import source.

## Tech Stack

- **Framework:** React Router v7
- **Styling:** Tailwind CSS v4
- **Aesthetic:** Neocities-era web design with modern implementation

## Design Philosophy

### Visual Style: Retro Neocities Meets Modern Tooling

artbin should look and feel like an old neocities webpage while being built with modern tools. Think: gaudy, bold, unapologetic web design from the era when the web was weird and personal.

**Layout:** Use modern CSS features freely (flex, grid, gap, etc.) - the implementation is modern, only the aesthetic is retro.

### Color Palette: Stark Named Colors Only

Use **only web standard named colors**. No hex codes, no RGB, no HSL. This constraint forces the gaudy, limited palette aesthetic.

**Approved colors** (the bold ones):
```
red, lime, blue, yellow, fuchsia, aqua, cyan, magenta
maroon, navy, teal, olive, purple, green
orange, pink, coral, tomato, gold, khaki
white, black, gray, silver, darkgray, lightgray
```

**Forbidden:** Any color that requires a hex code or looks "designed."

### Borders: Gaudy and Proud

Borders should be:
- **Thick** (2px minimum, 4px encouraged)
- **Colored** (use the named colors above)
- **Varied** (solid, dashed, dotted, double, ridge, groove, inset, outset)

### Tailwind Classes to Define

Create consistent utility classes that enforce the aesthetic:

```css
/* Example custom classes to add */
.border-gaudy { @apply border-4 border-fuchsia; }
.border-chunky { @apply border-4 border-double; }
.bg-loud { @apply bg-lime text-black; }
.link-90s { @apply text-blue underline hover:text-fuchsia; }
```

## Core Features

### 1. Authentication & Accounts

- **Login required** for all access (no public browsing)
- **Invite-based registration** - get an account by being invited
- **Account tree** - track who invited whom
- Future: admin user creation script

### 2. Textures (Primary Focus)

The main purpose of artbin.

**Upload & Organization:**
- Upload individual textures or entire folders from local computer
- Textures belong to collections owned by users
- Collections can be: public (all logged-in users), private, or shared with friends

**Search & Filtering:**
- Tag-based filtering system
- Core tags: `seamless`, `tileable`, `wood`, `grass`, `metal`, `stone`, `fabric`, `water`, `fire`, `sparkle`, `90s`, `pixel`, `photo`, `painted`
- Resolution filters
- Color-dominant filters (future)

**Texture Metadata:**
- Dimensions, file size, format
- Seamless/tileable flag
- Source attribution
- Tags

### 3. Game Assets (Secondary)

Beyond textures, support other visual game development assets:

- **3D Models** - with web-based model viewer component
- **Shaders** - GLSL snippets with preview
- **Sprites & Sprite Sheets**
- **UI Elements**

### 4. BSP & Game File Tools

Tools for extracting assets from game files. Leverage existing CLI tools rather than writing parsers from scratch.

**Reference implementations in `tmp/`:**
- `tmp/qpakman/` - PAK/BSP tooling for Quake-engine games
- `tmp/thirty_flights_of_loving/` - Example Quake II game with BSP maps to test against
- `tmp/noclip.website/` - WebGL game level viewer (study for model/level viewing)

**Planned tools:**
- BSP texture extraction (using qpakman or similar)
- PAK/PK3 archive browsing and extraction
- Texture ripping from uploaded game files

### 5. Viewers

Web components for viewing different asset types:

**Model Viewer:**
- Support common formats (OBJ, GLTF, FBX)
- Orbit camera, zoom, pan
- Material/texture preview
- Study `tmp/noclip.website/` for implementation patterns

**Level Viewer (Future):**
- BSP level viewing inspired by noclip.website
- Texture extraction from viewed levels

### 6. Admin Tools

For site administrators:

**Import Tools:**
- Import from TextureTown (textures.neocities.org)
- Bulk import from local directories
- Import from other texture sites (future)

**User Management:**
- User creation script (CLI)
- Invite code generation
- Account tree visualization

## Data Model (Draft)

```
User
  - id, email, username, password_hash
  - invited_by (User reference)
  - is_admin
  - created_at

Collection
  - id, name, description
  - owner (User)
  - visibility: public | private | friends
  - created_at

Texture
  - id, filename, path
  - collection (Collection)
  - uploader (User)
  - width, height, format, file_size
  - is_seamless
  - tags[]
  - source_url (if imported)
  - created_at

Tag
  - id, name, slug
  - category (optional)
```

## File Structure (Planned)

```
artbin/
  app/
    routes/
      _index.tsx          # Landing/login
      dashboard.tsx       # Main texture browser
      textures.$id.tsx    # Single texture view
      collections/
      admin/
    components/
      ModelViewer.tsx
      TextureGrid.tsx
      BorderBox.tsx       # Gaudy border wrapper
    styles/
      artbin.css          # Custom Tailwind classes
  scripts/
    create-user.ts        # Admin user creation
    import-texturetown.ts # TextureTown scraper
  tmp/                    # Reference implementations (gitignored)
    noclip.website/       # Level viewer reference
    qpakman/              # BSP tools reference
    thirty_flights_of_loving/  # Test BSP files
```

## Development Phases

### Phase 1: Foundation
- [ ] React Router v7 setup with Tailwind v4
- [ ] Define custom Tailwind classes for aesthetic
- [ ] Basic auth system (login, register with invite code)
- [ ] User model with invite tree

### Phase 2: Core Textures
- [ ] Texture upload (single file)
- [ ] Collection creation and management
- [ ] Basic texture grid view
- [ ] Tag system
- [ ] Search and filter

### Phase 3: Bulk Operations
- [ ] Folder upload
- [ ] Admin: TextureTown import
- [ ] Batch tagging

### Phase 4: Extended Assets
- [ ] Model upload and viewer
- [ ] BSP tools integration
- [ ] Shader snippets

## Resources

- [TextureTown](https://textures.neocities.org/) - Primary inspiration and import source
- [TextureTown API](https://textures.neocities.org/api.html) - For importing textures
- [noclip.website](https://noclip.website/) - Level viewer reference
- [qpakman](https://github.com/...) - BSP/PAK tools
