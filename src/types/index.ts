export type DepartmentId = 
  | 'executive'
  | 'engineering'
  | 'research'
  | 'creative'
  | 'marketing'
  | 'qa'
  | 'operations'
  | 'infrastructure';

export type AgentStatus = 
  | 'SLEEPING'
  | 'QUEUED'
  | 'WALKING'
  | 'WORKING'
  | 'COLLABORATING'
  | 'WAITING'
  | 'COMPLETED';

export type AgentRole =
  | 'Manager'
  | 'Frontend Engineer'
  | 'Backend Engineer'
  | 'Fullstack Engineer'
  | 'Python Engineer'
  | 'Java Engineer'
  | 'C++ Engineer'
  | 'Database Engineer'
  | 'Authentication Engineer'
  | 'DevOps Engineer'
  | 'Researcher'
  | 'AI Researcher'
  | 'Designer'
  | 'Graphics Designer'
  | 'Image Generation Agent'
  | 'Animation Agent'
  | 'Video Agent'
  | 'Marketing Agent'
  | 'Sales Agent'
  | 'Product Agent'
  | 'QA Agent'
  | 'Repair Agent'
  | 'Security Agent'
  | 'Performance Agent'
  | 'Accessibility Agent'
  | 'API Agent'
  | 'Skills Agent'
  | 'Cost Controller'
  | 'Communication Agent'
  | 'Monitoring Agent';

export type ScreenType = 'code' | 'terminal' | 'design' | 'research' | 'devops' | 'charts' | 'review' | 'screensaver';

export interface OfficeAgent {
  id: string;
  name: string;
  role: AgentRole;
  departmentId: DepartmentId;
  deskIndex: number;
  status: AgentStatus;
  currentTask: string | null;
  taskProgress: number; // 0 - 100
  avatarColor: string;
  clothingColor: string;
  hairColor: string;
  skinTone: string;
  tools: string[];
  brief: string;
  stats: {
    tasksCompleted: number;
    tokensBurned: number;
    uptime: string;
    accuracy: number;
  };
  screenType: ScreenType;
  screenSnippet: string;
  workstationPos: [number, number, number];
  currentPos: [number, number, number];
  targetPos: [number, number, number] | null;
  facingAngle: number;
  collaboratingWith: string | null;
  recentLogs: string[];
  pendingApproval?: {
    id: string;
    title: string;
    details: string;
  } | null;
}

export interface DepartmentInfo {
  id: DepartmentId;
  name: string;
  leadRole: string;
  leadAgentId: string;
  color: string;
  secondaryColor: string;
  position: [number, number, number];
  size: [number, number]; // width, depth
  metrics: {
    activeTasks: number;
    completedTasks: number;
    pendingApproval: number;
    metricLabel1: string;
    metricValue1: string | number;
    metricLabel2: string;
    metricValue2: string | number;
  };
  description: string;
}

export interface OfficeTask {
  id: string;
  title: string;
  description: string;
  departmentId: DepartmentId;
  assignedAgentId: string;
  status: 'queued' | 'in_progress' | 'review' | 'completed' | 'blocked';
  progress: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  handoffChain: string[]; // agent IDs
  currentChainIndex: number;
  artifacts: OfficeArtifact[];
  createdAt: string;
}

export interface OfficeArtifact {
  id: string;
  title: string;
  type: 'code' | 'diff' | 'document' | 'design' | 'report' | 'test';
  content: string;
  createdByAgentId: string;
  timestamp: string;
}

export interface OfficeHandoff {
  id: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  fromPos: [number, number, number];
  toPos: [number, number, number];
  progress: number; // 0 to 1 for traveling pulse
  label: string;
  active: boolean;
}

export interface OfficeNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'alert';
  agentId?: string;
  timestamp: string;
}

export interface CameraTarget {
  mode: 'overview' | 'department' | 'agent' | 'brain' | 'collaboration';
  targetPos: [number, number, number];
  cameraPos: [number, number, number];
  fov: number;
  targetEntityId?: string;
}
