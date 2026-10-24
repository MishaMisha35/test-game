# Eternal Realms — playable desktop prologue

Windows: download the Windows ZIP, extract the entire folder, and run `Eternal Realms.exe`.
Linux: download the Linux tar.gz, extract the entire folder, and run `./"Eternal Realms"`.
No browser, development server, or Node.js installation is required for play.
The Source ZIP contains the complete project and build instructions.

Implemented: a procedural 3D valley, movement and collisions, sword combat, three
spells, four wraiths, a two-phase Guardian, a quest, progression and local saves.
This is the playable first development stage. See README.md for controls and
limitations, and docs/STEAM.md for SteamPipe preparation.

The original Linux package was execution-tested in the cloud. Windows was
cross-packaged and requires testing on Windows. This automated CI build runs unit
and physics tests; it does not claim a fresh native Windows/Linux gameplay test.
No Steam upload has been performed. Steamworks services are not connected.
