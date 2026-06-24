# ContextLens — Product Hunt Launch Strategy Guide (产品发布指南)

> **Last Updated:** 2026-05-25
> **Status:** ⏳ Ready for submission (Wait for Chrome Web Store Approval)

This document is your complete playbook for launching **ContextLens** on Product Hunt. It contains the core selling points, preparation checklist, step-by-step launch timeline, and ready-to-use English listing assets and templates.

---

## 🌟 Why ContextLens is a Perfect Fit for Product Hunt

Product Hunt (PH) is highly populated by developers, designers, AI enthusiasts, and early adopters. ContextLens stands out due to three major factors:

1. **Unique Developer Workflow (The Bridge Server)**: Connecting browser selection to local CLI agents (`Claude Code`, `Antigravity CLI`, `Codex`) via a local bridge server to read and write code is an absolute game-changer. Most browser AI tools are just simple ChatGPT wrappers; this is an actual local developer tool loop.
2. **Premium Design (Glassmorphism & Micro-animations)**: The custom light glassmorphism UI, smooth transitions, and breathing connection lights are highly polished. Visually striking interfaces get up to **3x more engagement** on Product Hunt.
3. **Privacy-First Architecture**: Completely local storage (`chrome.storage.local`), direct peer-to-peer HTTPS API requests, and local agent execution appeal heavily to safety-conscious power users.

---

## 📅 Step-by-Step Launch Roadmap

### Phase 1: Pre-Launch (Do this now & during CWS Review)
1. **Chrome Web Store (CWS) Approval**: Ensure your extension is fully approved and listed on CWS. Users expect a simple one-click "Add to Chrome" install. Avoid making them download a `.zip` in developer mode, as this introduces too much friction.
2. **Create Visual Assets**:
   - **GIF 1 (Main Selection Flow)**: Selecting text on a web page, the floating `Lens` button appears, sidebar opens, and Gemini stream-replies.
   - **GIF 2 (Local Agent modification)**: Select a UI component or text, trigger the Local Agent via the Bridge Server, and show the terminal/editor automatically modifying the local file. **This is your "WOW" factor!**
   - **Cover Image (800x450px)**: A clean, colorful background featuring the ContextLens sidebar mockup.
   - **Demo Video (Optional but Recommended)**: A short 1-minute screencast demonstrating setup and core features with energetic background music.
3. **Register Maker Profiles**: Create your personal account on [Product Hunt](https://www.producthunt.com) and fill out your profile. Build a little reputation by upvoting and commenting on other products beforehand.

### Phase 2: Setting up the Launch (Scheduling)
1. **Launch Date**: Aim for a **Tuesday or Wednesday** for maximum traffic and exposure, or a **Saturday or Sunday** if you want lower competition and an easier path to "Product of the Day".
2. **Launch Time**: Schedule the launch exactly at **00:01 PST (Pacific Standard Time)**. This translates to **15:01 Beijing Time (GMT+8)**. Launching at the start of the PST day gives you a full 24 hours of visibility.

---

## 📝 Product Hunt Listing Assets (Copy-Paste Templates)

Use these English-written assets to fill out the Product Hunt submission form.

### 1. Product Details
* **Product Name**: `ContextLens`
* **Tagline (Max 60 chars)**: 
  > Sleek AI sidebar connecting web text to local dev agents & APIs
* **Description (Max 260 chars)**:
  > Select any web text to chat instantly with Gemini, OpenAI, Claude, or local Ollama. Seamlessly triggers local CLI agents (Claude Code, Antigravity CLI) via a local bridge to write or modify source code in real time. Sleek glassmorphism UI & privacy-first.
* **Topics/Tags**: `Developer Tools`, `Artificial Intelligence`, `Productivity`, `User Experience`.
* **Downloads / Links**:
  - **Chrome Web Store Link**: `[Your official CWS URL here]`
  - **GitHub / Homepage Link**: `[Your repository or landing page URL here]`

---

### 2. Maker's First Comment (置顶留言)
*Post this immediately after the launch goes live. It provides context, tells your story, and welcomes feedback.*

```markdown
Hi Product Hunt community! 👋

I'm the creator of ContextLens, and I'm super excited to share it with you all today! 🚀

### 💡 Why I built ContextLens
As a developer, I found myself constantly copying text, terminal logs, UI strings, or code snippets from the browser, opening separate chat tabs, or manually typing them into CLI tools like Claude Code or Antigravity CLI to fix local code. The constant window switching felt redundant and broke my flow.

I wanted a frictionless, beautiful, and privacy-first gateway that bridges what I see in the browser to both advanced cloud APIs and my local coding environment.

### ✨ What makes ContextLens different?
1. **Local Agent Bridge 🔌**: This is the core magic. Via a local lightweight Node.js Bridge Server, you can highlight a UI element or bug on a web page, and directly command local CLI agents (Claude Code, Codex, Antigravity CLI) to locate and rewrite the source code in your local directory!
2. **Smart DOM Context Extraction 🧠**: It doesn't just copy raw text. It automatically detects codeblocks (with language tags), formats HTML `<table>` elements into neat Markdown tables, captures heading hierarchies, and constructs the CSS breadcrumb path.
3. **Stunning Glassmorphism Design 💎**: Built with a premium, light-glassmorphism aesthetic that feels native to modern operating systems, complete with smooth animations, syntax highlighting, and breathing connection lights.
4. **100% Privacy-First 🔒**: No telemetry, no intermediate servers. Your API keys and chat histories are stored securely in your browser's local sandbox (`chrome.storage.local`). Direct point-to-point connections to your chosen AI providers.

I would love to hear your feedback, feature requests, or any questions you have! Run the bridge server, pin the extension, and let me know how it fits into your workflow!

Cheers! 🍻
```

---

## 📣 Launch Day Promotion & Engagement Strategy

Product Hunt's ranking algorithm values **authentic, active conversations** and votes from established users. Avoid spammy behaviors, as PH has highly sensitive spam filters.

### 1. The Golden Hour (First 2 hours)
* Post your **Maker's First Comment** immediately.
* Reach out to your close group of friends, peers, and developer networks. Share the link, explain the project, and ask them for **honest comments and feedback** (rather than just telling them to "vote").
* *Tip: Share your Product Hunt Profile link or search term instead of the direct product link. Direct link voting can sometimes trigger spam algorithms if clicked rapidly.*

### 2. Multi-Channel Distribution (Multi-lingual)
Spread the word across the global and local developer communities:

#### 🌐 Global Communities (English)
* **X (Twitter)**: Tweet about your launch. Mention key features like the Claude Code integration, share a high-quality GIF of the tool in action, use tags like `#ProductHunt`, `#AI`, and tag relevant developer accounts.
* **Hacker News (Show HN)**: 
  - Title: `Show HN: ContextLens – AI sidebar connecting web text to local coding agents`
  - Write a text post explaining the Node.js bridge server architecture and local scripting mechanics. Keep it technical and humble.
* **Subreddits**: Post on `r/chrome_extensions`, `r/ArtificialInteligence`, `r/developer`.

#### 🇨🇳 Local Communities (Chinese)
* **V2EX**: Post in `/go/share` or `/go/create`. Describe the architecture of the bridge server, the glassmorphic side-panel design, and give away some test/free API keys if applicable, or encourage them to run local models (Ollama).
* **Juejin (掘金) & SegmentFault**: Write an article detailing the development process, specifically how you extracted complex DOM properties in `content.js` and parsed SSE streaming events in `sidepanel.js`. Add your Product Hunt launch badge at the end of the post.

---

## 🏆 Checklist for the Win

- [ ] **Chrome Web Store** listing is live and the URL is verified.
- [ ] **Bridge Server** code is clean, and the quick startup instructions in `README.md` are tested.
- [ ] **Cover Mockups & Screenshots** (1280x800) are generated and look gorgeous.
- [ ] **Core GIFs** are optimized and under 5MB each (for fast loading on Product Hunt).
- [ ] **Product Hunt account** has been created and warmed up.
- [ ] **Maker Comments and Social Copy** are translated, proofread, and saved locally.

*Good luck with the launch! ContextLens has incredible potential to capture the developer audience. Let's make it go viral! 🚀*
