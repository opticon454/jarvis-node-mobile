# Mobile E2E coverage: screen → flow

What the Maestro flows in this directory cover, screen by screen, and why a screen has no
flow. The coverage gate (#148) reads this table: a screen is **covered** (a flow), **not
tested** (with the reason and who decided), or **later** (another E2E piece). One row per
screen in `src/screens/`; a sub-part of a screen gets its own row when its status differs.

Status words: `flow`, `not tested`, `later`, `skip` (a flow exists but is tagged skip; the
reason is in its `properties.skip_reason`).

| Screen (src/screens/) | Status | Flow / reason |
|---|---|---|
| Auth/LandingScreen | flow | every flow (subflows/login-as.yaml), register.yaml |
| Auth/LoginScreen | flow | every flow (subflows/login-as.yaml); bad login: register.yaml |
| Auth/RegisterScreen | flow | register.yaml (form checks, invite), household-members.yaml |
| Auth/ForcePasswordChangeScreen | skip | force-password-change.yaml: needs AUTH_URL from the runner |
| Settings/SettingsScreen: Account, Household, Voice, Appearance, Chat, Privacy, Connection, Smart Home, Config Service URL | flow | settings.yaml |
| Settings/SettingsScreen: Security (biometric login) | not tested | biometrics stay manual (user, 2026-10-17); biometric-login.yaml is skipped |
| Settings/SettingsScreen: Log Out (and staying logged out after a relaunch) | flow | auth-logout.yaml |
| Settings/SettingsScreen: each seeded role's household and role | flow | auth-roles.yaml |
| Settings/SettingsScreen: Delete Account | flow | subflows/delete-account.yaml (throwaway accounts only) |
| Settings/HouseholdEditScreen: name, admin sections | flow | household-edit.yaml |
| Settings/HouseholdEditScreen: members, role change, invite codes | flow | household-members.yaml, household-member-view.yaml |
| Settings/HouseholdEditScreen: watches and errand-autonomy switches | flow | household-watches-errands.yaml (admin toggles), household-member-view.yaml (read only) |
| Settings/HouseholdEditScreen: pantry toggle | not tested | packages (user, 2026-10-17) |
| Settings/HouseholdEditScreen: home presence (location) | not tested | needs a location fix; not in this piece |
| Settings/RecoveryCodeScreen: create, show, hide, a malformed code refused | flow | recovery-code.yaml; restore of a right code and giving the key to nodes need live nodes: jarvis-server scripts/e2e-fleet-config |
| Settings/FleetConfigScreen: no-key redirect, save a secret, remove it | flow | fleet-config.yaml; what a node does with it: jarvis-server scripts/e2e-fleet-config |
| Settings/SignalAutomationsScreen | flow | signal-automations.yaml |
| Settings/VoiceProfileScreen (no recording) | flow | voice-profile.yaml; recording is the voice lane's |
| Settings/IntegrationAuthScreen | later | not in piece 6 |
| Nodes/NodeListScreen | flow | nodes.yaml |
| Nodes/NodeDetailScreen: Overview, Activity | flow | nodes.yaml |
| Nodes/NodeDetailScreen: Packages tab | not tested | packages (user, 2026-10-17) |
| Nodes/NodeDetailScreen: rename | not tested | the app has no node rename |
| Nodes/HardwareTab | flow | nodes.yaml (when the node is not a docker install) |
| Nodes/NodeSettingsScreen | flow | nodes.yaml (the "key required" state; loaded settings need a live node) |
| Nodes/AddComputerScreen, FastPathInspectScreen | later | not in piece 6 |
| Memories/MemoriesListScreen, MemoriesEditScreen | flow | memories.yaml |
| Phonebook/PhonebookListScreen, PhonebookEditScreen | flow | phonebook.yaml |
| CallContext/CallContextListScreen, CallContextEditScreen | flow | call-context.yaml |
| RecentCommands/RecentCommandsListScreen | flow | settings.yaml (opens and closes) |
| RecentCommands/RecentCommandDetailScreen | later | not in piece 6 |
| Store/StoreBrowseScreen | not tested | packages (user, 2026-10-17) |
| Store/StoreDetailScreen | not tested | packages (user, 2026-10-17) |
| Store/NodePickerSheet | not tested | packages (user, 2026-10-17) |
| Store/InstallProgressScreen | not tested | packages (user, 2026-10-17) |
| Store/TestInstallScreen | not tested | packages (user, 2026-10-17) |
| Home/HomeScreen: quick-open deep links (deepLinks.ts) | flow | deep-links.yaml (com.jarvis.app://chat, open, stt) |
| Home/HomeScreen: Universal Link (https://docs.jarvisautomation.dev/app/...) | not tested | iOS-only entry point; Android has no App Link for it |
| Home/HomeScreen: chat (send, scripted reply) | flow | home-chat.yaml |
| Home/HomeScreen: chat tool calls (control_device, set_timer, shopping_list add) | flow | home-chat-tools.yaml (the sandbox's node is not running, so the reply is the scripted "node is offline" one: the call reached node dispatch) |
| Devices/DevicesScreen, Routines list, Pantry tab (they open and show seeded data) | flow | nav-tabs.yaml |
| Devices/DevicesScreen: open a device, the Rooms button | flow | devices.yaml |
| Devices/DevicesScreen: add a device, discovery | flow | devices.yaml (the scan ends: results, an error with Retry, or "No node is online"; importing needs a device to discover, no item filed yet) |
| Devices/DeviceEditScreen: name and details, save and delete buttons | flow | devices.yaml (opens a seeded device and goes back; nothing saved) |
| Devices/DeviceEditScreen: light on/off (LightControl) | skip | devices-light-toggle.yaml: needs the fake Home Assistant (#154) |
| Devices/RoomManagementScreen: add, rename, delete a room | flow | devices.yaml |
| Devices/ExternalDeviceDetailScreen | later | needs the fake Home Assistant (#154) |
| Routines/RoutineEditScreen: create, add a trigger phrase, delete | flow | routines.yaml (free-text step: the command catalog needs the node's key) |
| Routines/RoutineEditScreen: command catalog, schedule | later | needs a node with its key (piece 7) |
| Routines/RoutineListScreen: run now, swipe delete | later | run now needs a live node; delete is covered from the editor (routines.yaml) |
| Inbox/InboxListScreen | flow | inbox.yaml, inbox-suggestion.yaml (opens from Home's inbox button, items picked by title) |
| Inbox/InboxListScreen: select mode, bulk read and delete, swipe delete | later | changes the seeded items the other Inbox flows open (no item filed yet) |
| Inbox/InboxDetailScreen | flow | inbox.yaml (deep research: markdown body, sources), inbox-suggestion.yaml (server-plane buttons) |
| Inbox/InboxCallbackResultScreen | flow | inbox-suggestion.yaml ("Never suggest this" → the server's answer) |
| Inbox/SuppressedSuggestionsScreen | flow | inbox-suggestion.yaml (lists the new suppression, un-blocks it) |
| Inbox/InteractiveListScreen | flow | inbox.yaml (rows and the "Add {n}" count; the actions need a live node) |
| Inbox/AdapterDeployedScreen | flow | inbox.yaml (details; Revert calls the adapters API jarvisd does not serve) |
| Inbox/AdapterProposalScreen, AdapterProposalDetailScreen | not tested | no seeded item: the screen loads /api/v0/adapters/proposals, which jarvisd does not serve (the LoRA pipeline is cut; jarvis-server #457) |
| Inbox/WebViewPickerScreen | later | opened from an interactive_list row action with a start_url; the seed has none (no item filed yet) |
| Schedules/ScheduleListScreen | flow | schedules.yaml |
| Provisioning/*, ImportKey/ImportKeyScreen | skip | provisioning-devmode-happy-path.yaml, k2-crypto-roundtrip.yaml: need a dev-client build and the fake node (piece 7) |
| SmartHome/*, CommandData/* | later | not in piece 6 |
| Camera (Devices/CameraViewScreen, QR scan) | not tested | camera stays manual (user, 2026-10-17) |
