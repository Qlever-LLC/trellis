import ProgressBar from "npm:progress@2.0.3";

const PROGRESS_BAR_WIDTH = 32;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function progressTokens(transferredBytes: number, totalBytes: number) {
  return {
    transferred: formatBytes(transferredBytes),
    total: formatBytes(totalBytes),
  };
}

export class UploadProgress {
  #bar;
  #finished = false;
  #lastTransferredBytes = 0;

  constructor(readonly totalBytes: number) {
    this.#bar = new ProgressBar(
      "Uploading evidence [:bar] :percent :transferred/:total",
      {
        total: Math.max(totalBytes, 1),
        width: PROGRESS_BAR_WIDTH,
        complete: "=",
        incomplete: "-",
      },
    );

    this.#bar.tick(0, progressTokens(0, totalBytes));
  }

  update(transferredBytes: number): void {
    if (this.#finished) {
      return;
    }

    const safeTransferredBytes = Math.min(transferredBytes, this.totalBytes);
    const delta = safeTransferredBytes - this.#lastTransferredBytes;
    if (delta < 0) {
      return;
    }

    this.#lastTransferredBytes = safeTransferredBytes;
    this.#bar.tick(
      delta,
      progressTokens(safeTransferredBytes, this.totalBytes),
    );
  }

  finish(): void {
    if (this.#finished) {
      return;
    }

    if (this.#lastTransferredBytes < this.totalBytes) {
      this.update(this.totalBytes);
    }

    this.#finished = true;
  }
}
