import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";
import { speechText } from "../../src/components/panels/chat/chatFormat";

const PTT_TITLE = "Push to talk: hold and speak, release to send";
const END_CALL_TITLE = "Hang up the voice call";
const CALL_TITLE = "Start a voice call: continuous listening, hands free, talk over the agent to interrupt";
const VOICE_SETTINGS_TITLE = "Voice settings: provider, model, speech engine and reply voice";

// ─── Unit: what actually gets read aloud ───

test.describe("speechText", () => {
  test("a fenced code block is announced, never dictated", () => {
    const spoken = speechText("Here is the fix:\n\n```ts\nconst x: number = 1;\n```\n\nThat is all.");
    expect(spoken).toContain("(code block)");
    expect(spoken).not.toContain("const x");
    expect(spoken).not.toContain("```");
  });

  test("a short inline span is spoken but a long one is summarized", () => {
    expect(speechText("Call `handleSend` now.")).toBe("Call handleSend now.");
    const long = speechText("See `src/components/panels/ChatPanel.tsx line 3600 in the composer controls` here.");
    expect(long).toContain("(code)");
    expect(long).not.toContain("ChatPanel.tsx");
  });

  test("link targets are dropped and their labels kept", () => {
    expect(speechText("Read [the docs](https://example.com/a/b?c=1).")).toBe("Read the docs.");
  });

  test("headings, bullets and emphasis lose their punctuation scaffolding", () => {
    const spoken = speechText("## Summary\n\n- **first** item\n- second item");
    expect(spoken).not.toContain("#");
    expect(spoken).not.toContain("**");
    expect(spoken).not.toContain("- ");
    expect(spoken).toContain("first item");
    expect(spoken).toContain("second item");
  });

  test("table rows are structure, not speech", () => {
    const spoken = speechText("Results:\n\n| Check | Result |\n| --- | --- |\n| tests | pass |");
    expect(spoken).not.toContain("|");
    expect(spoken).toContain("Results:");
  });

  test("a long reply is cut at a sentence boundary and says so", () => {
    const sentence = "This is a reasonably long sentence that carries some detail. ";
    const spoken = speechText(sentence.repeat(40));
    expect(spoken.length).toBeLessThan(1100);
    expect(spoken).toContain("There is more on screen.");
    // The cut lands after a full stop rather than mid-word.
    expect(spoken).toMatch(/detail\. There is more on screen\.$/);
  });

  test("an ordinary reply passes through unharmed", () => {
    expect(speechText("The build is green and all tests pass.")).toBe("The build is green and all tests pass.");
  });
});

// ─── UI ───

/**
 * Replace the microphone with a synthetic audio source the VAD can actually
 * read. Chromium does not route audio from a MediaStreamDestination back into
 * an AnalyserNode in the same context, so overriding the AudioContext
 * constructor to share one context does not work. Instead we keep a real
 * AudioContext (so MediaRecorder gets genuine tracks) and inject synthetic
 * samples directly into AnalyserNode.prototype.getFloatTimeDomainData.
 * `__setMicLevel` is the volume knob the test speaks into.
 */
async function installSyntheticMic(page: Page, transcript: string) {
  await page.addInitScript((scripted: string) => {
    const w = globalThis as typeof globalThis & {
      __setMicLevel?: (value: number) => void;
      __micStream?: MediaStream;
      __BASEBUILD_E2E_TRANSCRIPT__?: string;
    };
    w.__BASEBUILD_E2E_TRANSCRIPT__ = scripted;
    let level = 0;
    let context: AudioContext | null = null;
    const RealAudioContext = window.AudioContext;
    window.AudioContext = class extends RealAudioContext {
      constructor() {
        if (context) return context;
        super();
        context = this;
        const dest = context.createMediaStreamDestination();
        // A silent oscillator keeps the stream's audio track alive so
        // MediaRecorder produces a real-sized blob. The VAD reads from the
        // getFloatTimeDomainData override, not this graph.
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 220;
        const gain = context.createGain();
        gain.gain.value = 0.001;
        oscillator.connect(gain);
        gain.connect(dest);
        oscillator.start();
        w.__micStream = dest.stream;
      }
    };
    AnalyserNode.prototype.getFloatTimeDomainData = function (array: Float32Array) {
      const amp = level * 0.5;
      for (let i = 0; i < array.length; i += 1) {
        array[i] = Math.sin(i * 0.1) * amp;
      }
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (!context) context = new window.AudioContext();
          await context.resume();
          return w.__micStream as MediaStream;
        },
      },
    });
    w.__setMicLevel = (value: number) => {
      level = value;
    };
  }, transcript);
}

async function setMicLevel(page: Page, value: number) {
  await page.evaluate((level: number) => {
    const w = globalThis as typeof globalThis & { __setMicLevel?: (value: number) => void };
    w.__setMicLevel?.(level);
  }, value);
}

/** Pick a configured, tools-capable route so a native session exists. */
async function selectNativeProvider(page: Page) {
  await page.locator(".chat-column-model-chip").first().click();
  const overlay = page.locator(".provider-catalog-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await page.locator(".provider-card", { hasText: "Umans" }).first().click();
  const modelRow = page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first();
  await expect(modelRow).toBeVisible({ timeout: 5_000 });
  await modelRow.click();
}

test.describe("voice controls", () => {
  test("the composer offers a microphone and a call button", async ({ page }) => {
    await installSyntheticMic(page, "");
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectNativeProvider(page);

    await expect(page.getByTitle(PTT_TITLE)).toBeVisible();
    await expect(page.getByTitle(CALL_TITLE)).toBeVisible();
    // Both are usable once a session exists, which is the whole complaint the
    // feature answers: there was no way to talk to the agent at all.
    await expect(page.getByTitle(PTT_TITLE)).toBeEnabled();
    await expect(page.getByTitle(CALL_TITLE)).toBeEnabled();
  });

  test("voice settings persist the chosen engine and mode", async ({ page }) => {
    await installSyntheticMic(page, "");
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectNativeProvider(page);

    await page.getByTitle(CALL_TITLE).click();
    await expect(page.locator(".voice-call-bar")).toBeVisible({ timeout: 10_000 });
    await page.getByTitle(VOICE_SETTINGS_TITLE).click();

    const modal = page.locator(".voice-settings-modal");
    await expect(modal).toBeVisible();
    // Push to talk is offered alongside call mode, as requested.
    await modal.getByTitle("The microphone is open only while you hold the button.").click();
    await modal.getByTitle("Show replies on screen only").click();
    await modal.getByTitle("Save these voice preferences").click();
    await expect(modal).toBeHidden();

    // Readback off is reflected back in the call strip.
    await expect(page.locator(".voice-call-bar")).toContainText("Readback off");
  });

  test("the call strip reports listening and releases the microphone on hang up", async ({ page }) => {
    await installSyntheticMic(page, "");
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectNativeProvider(page);

    await page.getByTitle(CALL_TITLE).click();
    const bar = page.locator(".voice-call-bar");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(bar).toContainText("Listening");
    await expect(bar).toHaveAttribute("data-voice-state", "idle");

    // Muting is not hanging up: the strip stays, the state changes.
    await page.getByTitle("Mute the microphone without ending the call").click();
    await expect(bar).toHaveAttribute("data-voice-state", "muted");
    await expect(bar).toContainText("Muted");
    await page.getByTitle("Unmute the microphone").click();
    await expect(bar).toHaveAttribute("data-voice-state", "idle");

    await page.getByTitle(END_CALL_TITLE).click();
    await expect(bar).toBeHidden();
    // Every captured track is stopped, so the OS microphone indicator clears.
    const live = await page.evaluate(() => {
      const w = globalThis as typeof globalThis & { __micStream?: MediaStream };
      return (w.__micStream?.getTracks() ?? []).filter((track) => track.readyState === "live").length;
    });
    expect(live).toBe(0);
  });
});

test.describe("voice call pipeline", () => {
  test("speaking during a call transcribes and sends the utterance", async ({ page }) => {
    await installSyntheticMic(page, "add a null check to the parser");
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectNativeProvider(page);

    await page.getByTitle(CALL_TITLE).click();
    const bar = page.locator(".voice-call-bar");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(bar).toHaveAttribute("data-voice-state", "idle");

    // Speak: the energy gate should open and start capturing.
    await setMicLevel(page, 0.5);
    await expect(bar).toHaveAttribute("data-voice-state", "capturing", { timeout: 10_000 });

    // Record enough audio to clear the minimum-utterance guard, then fall
    // silent so the endpointer closes the turn.
    await page.waitForTimeout(700);
    await setMicLevel(page, 0);

    // The transcript is delivered as a normal user turn.
    await expect(
      page.locator(".chat-message-user", { hasText: "add a null check to the parser" }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("a blip too short to be speech is discarded instead of transcribed", async ({ page }) => {
    await installSyntheticMic(page, "this should never be sent");
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectNativeProvider(page);

    await page.getByTitle(CALL_TITLE).click();
    await expect(page.locator(".voice-call-bar")).toBeVisible({ timeout: 10_000 });

    // A door slam: loud, but far under the minimum utterance length.
    await setMicLevel(page, 0.6);
    await page.waitForTimeout(120);
    await setMicLevel(page, 0);

    // Give the endpointer well past its silence window to prove nothing is sent.
    await page.waitForTimeout(2_500);
    await expect(page.locator(".chat-message-user", { hasText: "this should never be sent" })).toHaveCount(0);
  });
});
