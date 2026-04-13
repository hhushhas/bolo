# Bolo

Bolo is a calm, fast-start YouTube transcriber for people who just want to paste a link, read the text, and share it.

## What is built

- Expo React Native app with a single, grandma-friendly flow
- YouTube URL preview for normal videos and Shorts
- Convex-backed history for saved transcripts and translations
- Translation pipeline using AI SDK 6 with the OpenRouter community provider
- Built-in reader with copy and WhatsApp sharing
- Gruvbox light and dark theming

## Architecture

- Expo client stays thin so startup stays fast.
- Video preview is fetched directly in the app with YouTube oEmbed.
- Convex actions handle transcript fetching, translation, and persistence.
- The current repo includes a temporary `convex/_generated` shim so the project can compile before a real Convex deployment is attached.
- Once you provide the real Convex deployment, run `pnpm convex:dev` to replace those shims with generated files.

## Local setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy the Expo client env:

```bash
cp .env.example .env.local
```

3. Set your Convex project:

```bash
pnpm convex:dev
```

4. Put your Convex deployment URL into `.env.local`:

```bash
EXPO_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

5. Set the OpenRouter secrets in Convex:

```bash
pnpm exec convex env set OPENROUTER_API_KEY=your_key
pnpm exec convex env set OPENROUTER_TRANSLATION_MODEL=openai/gpt-4o-mini
```

6. Start the app:

```bash
pnpm start
```

## Convex notes

- The action entry point is [convex/transcribe.ts](/Users/agents/Desktop/Code/youtube-transcriber/convex/transcribe.ts).
- The table definition is [convex/schema.ts](/Users/agents/Desktop/Code/youtube-transcriber/convex/schema.ts).
- After real Convex codegen is available, replace the temporary files in [convex/_generated/api.ts](/Users/agents/Desktop/Code/youtube-transcriber/convex/_generated/api.ts), [convex/_generated/server.ts](/Users/agents/Desktop/Code/youtube-transcriber/convex/_generated/server.ts), and [convex/_generated/dataModel.d.ts](/Users/agents/Desktop/Code/youtube-transcriber/convex/_generated/dataModel.d.ts).

## Publishing plan

1. Run the local gate:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

2. Log into Expo Application Services:

```bash
eas login
```

3. Create internal preview builds:

```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

4. Create production builds:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

5. Submit when the store metadata is ready:

```bash
eas submit --platform ios --profile production
eas submit --platform android --profile production
```
