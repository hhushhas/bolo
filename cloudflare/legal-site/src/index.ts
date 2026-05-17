const updatedAt = "May 17, 2026";
const playTestingUrl = "https://play.google.com/apps/testing/com.q9labsai.bolo";
const storeScreenshots = [
  "https://lh3.googleusercontent.com/CRSObL_Zq5bQSEXv6LGvdGIZm2NDmdK4PCc7WsyCLmz2jeUINpjoPk9mPtj3qxFjT9Q",
  "https://lh3.googleusercontent.com/9xTExhD84zc6Wf_f5Ara-FpLjsSsfwSvB_93bfn2ml1-eOHncnmgawkqxQmVw2ZXeA",
];

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
    `<section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Synced bilingual video translation</p>
        <h1>Watch the video. Read the meaning. Stay in rhythm.</h1>
        <p class="lead">Bolo turns YouTube videos into a timestamped bilingual player, pairing the original speech with a readable translation that follows the video as it plays.</p>
        <div class="actions">
          <a class="primary-action" href="${playTestingUrl}">Join Android test</a>
          <a class="secondary-action" href="/privacy">Privacy</a>
        </div>
      </div>
      <div class="device-row" aria-label="Bolo app screenshots">
        <img src="${storeScreenshots[0]}" alt="Bolo home screen for pasting a YouTube video URL">
        <img src="${storeScreenshots[1]}" alt="Bolo synced bilingual video player">
      </div>
    </section>
    <section class="feature-band" aria-label="Bolo features">
      <article>
        <span>01</span>
        <h2>Video and transcript together</h2>
        <p>Keep the video in view while the active transcript line follows along beside it.</p>
      </article>
      <article>
        <span>02</span>
        <h2>Bilingual by default</h2>
        <p>Compare the original words with a translation without losing the speaker's timing.</p>
      </article>
      <article>
        <span>03</span>
        <h2>Built for real watching</h2>
        <p>Portrait, landscape, saved entries, and clean status updates for longer videos.</p>
      </article>
    </section>
    <footer class="site-footer">
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms</a>
    </footer>`,
    "home",
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
    "document",
  );
}

function renderPage(title: string, body: string, pageClass = "document") {
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
        margin: 0 auto;
      }
      .document {
        max-width: 760px;
        padding: 56px 24px 72px;
      }
      .home {
        max-width: 1180px;
        padding: 24px 24px 48px;
      }
      .hero {
        min-height: calc(100vh - 72px);
        display: grid;
        grid-template-columns: minmax(0, 0.92fr) minmax(360px, 1.08fr);
        gap: 44px;
        align-items: center;
      }
      .hero-copy {
        max-width: 580px;
      }
      .eyebrow {
        margin-bottom: 14px;
        color: #25625e;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 40px;
        line-height: 1.05;
        letter-spacing: 0;
      }
      .home h1 {
        max-width: 620px;
        font-size: 68px;
        line-height: 0.98;
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
      .lead {
        max-width: 560px;
        color: #4b4738;
        font-size: 20px;
        line-height: 1.55;
      }
      .date {
        color: #6f674d;
      }
      .actions,
      .site-footer {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      a {
        color: #25625e;
        font-weight: 700;
      }
      .primary-action,
      .secondary-action {
        display: inline-flex;
        min-height: 46px;
        align-items: center;
        justify-content: center;
        border: 1px solid #25625e;
        border-radius: 6px;
        padding: 0 18px;
        text-decoration: none;
      }
      .primary-action {
        background: #25625e;
        color: #fffaf0;
      }
      .secondary-action {
        background: transparent;
      }
      .device-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
        align-items: center;
      }
      .device-row img {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(37, 35, 29, 0.14);
        border-radius: 8px;
        box-shadow: 0 24px 70px rgba(37, 35, 29, 0.18);
      }
      .device-row img:nth-child(2) {
        margin-top: 48px;
      }
      .feature-band {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1px;
        overflow: hidden;
        border: 1px solid rgba(37, 35, 29, 0.12);
        border-radius: 8px;
        background: rgba(37, 35, 29, 0.12);
      }
      .feature-band article {
        background: #fffbea;
        padding: 24px;
      }
      .feature-band span {
        color: #9c6f2d;
        font-size: 13px;
        font-weight: 800;
      }
      .feature-band h2 {
        margin-top: 14px;
      }
      .site-footer {
        justify-content: center;
        margin-top: 36px;
      }
      @media (max-width: 860px) {
        .home {
          padding: 20px 16px 40px;
        }
        .hero {
          min-height: auto;
          grid-template-columns: 1fr;
          gap: 28px;
          padding-top: 24px;
        }
        .home h1 {
          font-size: 44px;
        }
        .lead {
          font-size: 17px;
        }
        .device-row {
          grid-template-columns: repeat(2, minmax(140px, 1fr));
          gap: 12px;
        }
        .device-row img:nth-child(2) {
          margin-top: 28px;
        }
        .feature-band {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="${pageClass}">
      ${pageClass === "home" ? "" : `<h1>${escapeHtml(title)}</h1>`}
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
