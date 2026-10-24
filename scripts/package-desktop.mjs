import { packager } from "@electron/packager";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = manifest.version;
const electronChecksums = JSON.parse(
  await readFile(
    join(root, "node_modules", "electron", "checksums.json"),
    "utf8",
  ),
);
const release = join(root, "release");
const platforms = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["win32", "linux"];
for (const platform of platforms) {
  if (!["win32", "linux"].includes(platform))
    throw new Error(`Unsupported target ${platform}; choose win32 or linux.`);
}
await stat(join(root, "dist", "index.html")).catch(() => {
  throw new Error("Build the renderer first: npm run build");
});
await mkdir(release, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), "eternal-desktop-"));
function command(program, args, cwd = root) {
  return new Promise((resolveCommand, reject) => {
    const proc = spawn(program, args, { cwd, stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0
        ? resolveCommand()
        : reject(new Error(`${program} exited with ${code}`)),
    );
  });
}
async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
try {
  await cp(join(root, "dist"), join(staging, "dist"), { recursive: true });
  await cp(join(root, "electron"), join(staging, "electron"), {
    recursive: true,
  });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify(
      {
        name: "eternal-realms",
        productName: "Eternal Realms",
        version,
        description:
          "Eternal Realms: Shadow of the Ancients — playable fantasy RPG prototype",
        main: "electron/main.cjs",
        author: "Eternal Realms",
        private: true,
      },
      null,
      2,
    ),
  );
  const sums = [];
  for (const platform of platforms) {
    const [output] = await packager({
      dir: staging,
      out: release,
      name: "Eternal Realms",
      executableName: "Eternal Realms",
      platform,
      arch: "x64",
      electronVersion: manifest.devDependencies.electron,
      overwrite: true,
      prune: true,
      asar: true,
      appCopyright: "Eternal Realms contributors",
      download: {
        cacheRoot:
          process.env.ELECTRON_CACHE ||
          join(tmpdir(), "eternal-electron-cache"),
        checksums: electronChecksums,
      },
    });
    const instructions =
      platform === "win32"
        ? "ETERNAL REALMS — Windows x64\n\nExtract the complete ZIP to a writable folder. Double-click Eternal Realms.exe.\nKeep all included files together. No browser, Node.js, or Internet connection is required.\nF11 toggles full screen. Controls and settings are available in the game.\nThis prototype is not code-signed; Windows may show an unknown-publisher prompt.\nDo not download replacement DLLs. Only use an archive from a source you trust.\nSaves are local to your OS user account. See the source README for prototype limitations.\n"
        : 'ETERNAL REALMS — Linux x64\n\nExtract the complete tar.gz archive. In the extracted folder run:\n  ./"Eternal Realms"\n\nKeep all included files together. No browser, Node.js, or Internet connection is required.\nA desktop session, compatible GPU, and common GTK/NSS/audio libraries are required.\nF11 toggles full screen. Controls and settings are available in the game.\nUse the distribution\'s supported unprivileged-user-namespace configuration for Chromium sandboxing.\nDo not run the game as root or routinely disable its sandbox.\nSaves are local to your OS user account. See the source README for prototype limitations.\n';
    await writeFile(join(output, "START-HERE.txt"), instructions);
    const folder = output.split(/[\\/]/).at(-1);
    const extension = platform === "win32" ? "zip" : "tar.gz";
    const archive = `Eternal-Realms-${version}-${platform === "win32" ? "Windows" : "Linux"}-x64.${extension}`;
    const archivePath = join(release, archive);
    await rm(archivePath, { force: true });
    if (platform === "win32")
      await command("zip", ["-q", "-r", archivePath, folder], release);
    else await command("tar", ["-czf", archivePath, "-C", release, folder]);
    const sum = await checksum(archivePath);
    sums.push(`${sum}  ${archive}`);
    console.log(`Created ${archivePath}`);
  }
  await writeFile(join(release, "SHA256SUMS.txt"), sums.join("\n") + "\n");
} finally {
  await rm(staging, { recursive: true, force: true });
}
