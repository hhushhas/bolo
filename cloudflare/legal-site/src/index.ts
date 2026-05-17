const updatedAt = "May 17, 2026";

const privacySections = [
  {
    title: "Overview",
    body: "Bolo lets users paste a YouTube URL, generate a transcript, translate it, and view the video with a synced bilingual transcript.",
  },
  {
    title: "Data We Process",
    body: "Bolo processes the YouTube URL you submit, selected source and target languages, generated transcript segments, generated translations, processing status, and basic technical metadata needed to run and debug the service.",
  },
  {
    title: "Service Providers",
    body: "Bolo uses Convex for app data and workflow orchestration, Cloudflare for media processing, temporary audio chunks, and AI transcription, OpenRouter for translation, and YouTube playback/embed services for video viewing.",
  },
  {
    title: "Temporary Audio",
    body: "Audio chunks are temporary processing artifacts. Bolo deletes temporary audio chunks after successful processing. Failed jobs may keep limited diagnostic metadata so the app can explain what went wrong.",
  },
  {
    title: "Data Sharing",
    body: "Bolo does not sell personal data. Data is shared with service providers only as needed to provide transcription, translation, storage, and app functionality.",
  },
  {
    title: "User Controls",
    body: "Users can avoid processing a video by not submitting its URL. Saved entries are shown in the app history.",
  },
  {
    title: "Contact",
    body: "For privacy questions, contact the developer through the Google Play listing.",
  },
];

const termsSections = [
  {
    title: "Use of Bolo",
    body: "Bolo is provided as a video translation and transcript reading tool. Users are responsible for the YouTube URLs they submit and for complying with applicable laws, platform terms, and content rights.",
  },
  {
    title: "Generated Output",
    body: "Generated transcripts and translations may contain mistakes. Bolo should not be used as the sole source for legal, medical, financial, emergency, or other high-stakes decisions.",
  },
  {
    title: "Availability",
    body: "The service may fail when a video cannot be accessed, processed, transcribed, or translated. Availability depends on third-party services including YouTube, Convex, Cloudflare, and OpenRouter.",
  },
];

type Section = {
  title: string;
  body: string;
};

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return htmlResponse(renderHome());
    }

    if (url.pathname === "/privacy" || url.pathname === "/privacy-policy") {
      return htmlResponse(renderDocument("Privacy Policy", privacySections));
    }

    if (url.pathname === "/terms") {
      return htmlResponse(renderDocument("Terms", termsSections));
    }

    return new Response("Not found", { status: 404 });
  },
};

function renderHome() {
  return renderPage(
    "Bolo",
    `<p>Bolo is a bilingual video translation app for watching YouTube videos with synced transcripts and translations.</p>
    <nav>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms</a>
    </nav>`,
  );
}

function renderDocument(title: string, sections: Section[]) {
  const sectionHtml = sections
    .map(
      (section) => `<section>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.body)}</p>
      </section>`,
    )
    .join("");

  return renderPage(
    `Bolo ${title}`,
    `<p class="date">Effective date: ${updatedAt}</p>${sectionHtml}`,
  );
}

function renderPage(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        background: #fbf7df;
        color: #25231d;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #fbf7df;
      }
      main {
        box-sizing: border-box;
        max-width: 760px;
        margin: 0 auto;
        padding: 56px 24px 72px;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 40px;
        line-height: 1.05;
        letter-spacing: 0;
      }
      h2 {
        margin: 32px 0 8px;
        font-size: 18px;
        line-height: 1.25;
        letter-spacing: 0;
      }
      p {
        margin: 0 0 16px;
        color: #4b4738;
        font-size: 16px;
        line-height: 1.7;
      }
      .date {
        color: #6f674d;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      a {
        color: #25625e;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
