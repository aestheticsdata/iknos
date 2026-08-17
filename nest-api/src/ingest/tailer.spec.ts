import { describe, expect, it } from "vitest";
import { serviceAndStream } from "./tailer";

/**
 * Every case here comes from ks-b's actual `~/.pm2/logs` listing.
 *
 * The first deployment of the collector filled the table with services called
 * `pfa-nest-api-out-39` — which is what a name parser written against the documented shape rather
 * than the observed one produces.
 */
describe("serviceAndStream", () => {
  it("strips the pm2 process id", () => {
    expect(serviceAndStream("/home/debian/.pm2/logs/pfa-nest-api-out-39.log")).toEqual({
      service: "pfa-nest-api",
      stream: "out",
    });
    expect(serviceAndStream("/home/debian/.pm2/logs/pfa-front-error-42.log")).toEqual({
      service: "pfa-front",
      stream: "err",
    });
  });

  it("resolves the same app to one service across pm2 restarts", () => {
    // PM2 hands out a new id on every restart and leaves the old file in place, so these two sit
    // side by side in the directory. A rail listing them separately would be listing history.
    const old = serviceAndStream("/logs/1991chat-backend-out-45.log");
    const current = serviceAndStream("/logs/1991chat-backend-out-5.log");

    expect(old).toEqual(current);
    expect(current.service).toBe("1991chat-backend");
  });

  it("keeps stdout and stderr as one service, told apart by the stream", () => {
    const out = serviceAndStream("/logs/zeus-nest-api-out-50.log");
    const err = serviceAndStream("/logs/zeus-nest-api-error-50.log");

    expect(out.service).toBe(err.service);
    expect(out.stream).toBe("out");
    // This is what makes an unlabelled line in an error file an error rather than an info.
    expect(err.stream).toBe("err");
  });

  it("still handles a file with no process id", () => {
    expect(serviceAndStream("/logs/worldweathr-out.log")).toEqual({ service: "worldweathr", stream: "out" });
    expect(serviceAndStream("/logs/worldweathr-error.log")).toEqual({ service: "worldweathr", stream: "err" });
  });

  it("leaves a name alone when it has no stream suffix", () => {
    // Apps that set `out_file` explicitly get a plain name, and there is nothing to strip.
    expect(serviceAndStream("/logs/shatter-api.log")).toEqual({ service: "shatter-api", stream: "out" });
  });

  it("does not eat digits that are part of the application's name", () => {
    expect(serviceAndStream("/logs/foo-2-out-14.log").service).toBe("foo-2");
    expect(serviceAndStream("/logs/1991chat-front-error-46.log").service).toBe("1991chat-front");
  });
});
