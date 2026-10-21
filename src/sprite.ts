// Plays atlas cells as a CSS background on one element. Each frame waits its own duration,
// and the pose is re-read every frame so state changes take effect at the next frame boundary.
import { ANIMATIONS, CELL_HEIGHT, CELL_WIDTH, lookCell } from "./atlas";
import { Pose } from "./mood";

interface Sheet {
  url: string;
  width: number;
  height: number;
}

const LOOK_POLL_MS = 200;

function poseKey(pose: Pose): string {
  return pose.kind === "look" ? `look:${pose.index}` : pose.state;
}

export class PetSprite {
  private timer: number | null = null;
  private key = "";
  private frame = 0;
  private scale = 0.5;

  constructor(
    private readonly el: HTMLElement,
    private readonly sheet: Sheet,
    private readonly readPose: () => Pose,
    private readonly reducedMotion: () => boolean,
  ) {
    el.style.backgroundImage = `url("${sheet.url}")`;
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.el.style.width = `${CELL_WIDTH * scale}px`;
    this.el.style.height = `${CELL_HEIGHT * scale}px`;
    this.el.style.backgroundSize = `${this.sheet.width * scale}px ${this.sheet.height * scale}px`;
    this.paint(this.readPose());
  }

  start(): void {
    this.stop();
    this.step();
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  // Called when input may have changed the pose; switches right away instead of at the next frame.
  refresh(): void {
    if (poseKey(this.readPose()) !== this.key) this.start();
  }

  private step(): void {
    const pose = this.readPose();
    const key = poseKey(pose);
    if (key !== this.key) {
      this.key = key;
      this.frame = 0;
    }
    this.paint(pose);
    let delay = LOOK_POLL_MS;
    if (pose.kind === "animation") {
      const durations = ANIMATIONS[pose.state].durations;
      delay = durations[this.frame];
      // Reduced motion holds the first frame, still re-checking the pose.
      if (!this.reducedMotion()) this.frame = (this.frame + 1) % durations.length;
    }
    this.timer = window.setTimeout(() => this.step(), delay);
  }

  private paint(pose: Pose): void {
    const cell =
      pose.kind === "look"
        ? lookCell(pose.index)
        : { row: ANIMATIONS[pose.state].row, column: this.frame };
    this.el.style.backgroundPosition = `${-cell.column * CELL_WIDTH * this.scale}px ${-cell.row * CELL_HEIGHT * this.scale}px`;
  }
}
