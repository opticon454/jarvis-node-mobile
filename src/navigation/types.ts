import { NavigatorScreenParams } from '@react-navigation/native';

export type ProvisioningStackParamList = {
  ScanForNodes: undefined;
  NodeInfo: undefined;
  SelectNetwork: undefined;
  EnterPassword: undefined;
  ProvisioningProgress: undefined;
  Success: undefined;
};

export type AuthStackParamList = {
  Landing: undefined;
  Login: undefined;
  Register: undefined;
};

export type NodesStackParamList = {
  NodeList: undefined;
  AddNode: undefined;
  AddComputer: undefined;
  NodeDetail: { nodeId: string; initialTab?: 'overview' | 'hardware' | 'packages' | 'activity' };
  NodeSettings: { nodeId: string; room: string | null };
  ImportKey: undefined;
  IntegrationAuth: {
    authConfig: string;          // JSON-serialized AuthenticationConfig
    nodeId: string;
    accessToken: string;
    providerBaseUrl?: string;    // Skip discovery if known
  };
  FastPathInspect: {
    nodeId: string;
    groupName: string;
    // JSON-serialized [{ command_name, fast_paths: FastPathEntry[] }] —
    // navigation params must be serializable.
    commandsJson: string;
  };
};

export type DevicesStackParamList = {
  DevicesList: undefined;
  DeviceEdit: { deviceId: string; householdId: string };
  ExternalDeviceDetail: { device: string; householdId: string };
  RoomManagement: undefined;
  DeviceDiscovery: { nodeId: string };
  CameraView: { deviceId: string; householdId: string; deviceName: string };
};

export type SmartHomeSetupParamList = {
  SmartHomeSetup: undefined;
  HADiscovery: undefined;
  HAAuth: { haUrl: string };
  HADeviceImport: { haUrl: string; haToken: string };
  DeviceRoomAssignment: {
    selectedDevices: string; // JSON-serialized (nav params must be serializable)
    areas: string;          // JSON-serialized
    source?: 'home_assistant' | 'direct';
    haUrl?: string;
    haToken?: string;
  };
  DeviceDiscovery: { nodeId: string };
  DeviceList: { householdId: string };
  IntegrationAuth: {
    authConfig: string;     // JSON-serialized AuthenticationConfig
    nodeId: string;
    accessToken: string;
    providerBaseUrl?: string;
  };
};

export type CommandDataStackParamList = {
  /** Top-level data browser. Shows node picker when >1 node, then commands.
   *  When `nodeId` is passed, the picker is skipped and the screen shows
   *  the commands for that node directly — used when entering from a
   *  node-scoped surface (e.g. NodeSettings options menu). */
  DataBrowserHome: { nodeId?: string } | undefined;
  /** Records list for one command on one node. */
  DataBrowserRecords: { nodeId: string; commandName: string };
  /** Read-only detail for one record. */
  DataBrowserDetail: {
    nodeId: string;
    commandName: string;
    recordKey: string;
  };
  /** Editable form for one record. Omit `recordKey` to create a new one. */
  DataBrowserEdit: {
    nodeId: string;
    commandName: string;
    recordKey?: string;
  };
};

export type RoutinesStackParamList = {
  RoutineList: undefined;
  RoutineEdit: { routineId?: string };
  ScheduleList: undefined;
};

export type InboxStackParamList = {
  InboxList: undefined;
  InboxDetail: { itemId: string };
  // The household's "never suggest this again" blocklist for agent-proposed
  // action cards. Reached from the Inbox header (where the proposals land).
  SuppressedSuggestions: undefined;
  // Pushed onto the stack when a user taps an InteractiveElement whose
  // navigation_type is "stack". Polls the callback's status endpoint
  // until the result lands, then renders the same body/chip layout as
  // InboxDetail — but inline, no separate inbox row.
  InboxCallbackResult: { jobId: string; title?: string; targetNodeId?: string };
  AdapterProposal: { itemId: string };
  AdapterProposalDetail: { proposalId: string };
  AdapterDeployed: { itemId: string };
  InteractiveList: {
    itemId: string;
    // Roundtrip return values from WebViewPicker. The inbox metadata is
    // a snapshot, so the picker navigates back here with the key/field/
    // value it just saved and the screen merges them into a local
    // gate-override map — no refetch needed.
    pickedKey?: string;
    pickedField?: string;
    pickedValue?: string;
  };
  WebViewPicker: {
    itemId: string; // inbox item — needed to navigate back to InteractiveList
    rowKey: string; // record to patch (the row's key)
    nodeId: string; // node that owns the record
    commandName: string; // record-API target (the action's save.command_name)
    field: string; // record field to patch (the action's save.field)
    startUrl: string; // already substituted ({label}/{value}); must be https
    pattern: string; // JS regex source; capture group 1 = the value
    // Stored value, when one exists. Detecting it again shows an info bar
    // instead of the "Use this value" button — the user browses away and
    // re-picks if the stored mapping is wrong.
    currentValue?: string;
  };
};

export type RecentCommandsStackParamList = {
  RecentCommandsList: undefined;
  RecentCommandDetail: { transcriptId: number };
};

export type MemoriesStackParamList = {
  MemoriesList: undefined;
  MemoryEdit: { memoryId?: number };
};

export type PhonebookStackParamList = {
  PhonebookList: undefined;
  /** Omit `contactId` to add a new business. */
  PhonebookEdit: { contactId?: string };
};

export type CallContextStackParamList = {
  CallContextList: undefined;
  /**
   * The whole list is saved as a unit, so the editor is handed the current
   * fields and the index it is editing (omit `index` to add a new one), plus
   * the catalog for the category/tier pickers. Plain serializable data — the
   * list screen reloads on focus to reflect what was saved.
   */
  CallContextEdit: {
    fields: import('../api/callContextApi').CallContextField[];
    catalog: import('../api/callContextApi').CallContextCatalog;
    index?: number;
  };
};

export type StoreStackParamList = {
  StoreBrowse: undefined;
  StoreDetail: { commandName: string };
  TestInstall: undefined;
  NodePickerSheet: {
    nodes: string;           // JSON-serialized NodeInfo[]
    commandName: string;
    githubRepoUrl: string;
    gitTag: string;
    latestVersion: string;
    packageName: string;
    installedNodeIds: string; // JSON-serialized string[] of node IDs that already have this command
    installedVersions: string; // JSON-serialized Record<nodeId, installedVersion | "unknown">
  };
  InstallProgress: {
    installs: string;        // JSON-serialized InstallEntry[]
    packageName: string;
    commandName: string;
    githubRepoUrl: string;
    gitTag: string | null;
    mode?: 'store' | 'test' | 'cc-provider'; // 'cc-provider' polls CC directly
  };
};

export type MainTabParamList = {
  HomeTab: undefined;
  DevicesTab: NavigatorScreenParams<DevicesStackParamList> | undefined;
  StoreTab: NavigatorScreenParams<StoreStackParamList> | undefined;
  RoutinesTab: NavigatorScreenParams<RoutinesStackParamList> | undefined;
  NodesTab: NavigatorScreenParams<NodesStackParamList> | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  Inbox: NavigatorScreenParams<InboxStackParamList>;
  RecentCommands: NavigatorScreenParams<RecentCommandsStackParamList> | undefined;
  Settings: undefined;
  HouseholdEdit: { householdId: string; householdName: string };
  SignalAutomations: { householdId: string };
  SmartHomeSetup: NavigatorScreenParams<SmartHomeSetupParamList>;
  VoiceProfile: undefined;
  RecoveryCode: undefined;
  FleetConfig: undefined;
  CommandData: NavigatorScreenParams<CommandDataStackParamList>;
  Memories: NavigatorScreenParams<MemoriesStackParamList> | undefined;
  Phonebook: NavigatorScreenParams<PhonebookStackParamList> | undefined;
  CallContext: NavigatorScreenParams<CallContextStackParamList> | undefined;
};
