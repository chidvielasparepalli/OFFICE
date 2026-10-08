import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react'
import type {
  OfficeAgent,
  DepartmentInfo,
  OfficeTask,
  OfficeHandoff,
  OfficeNotification,
  CameraTarget,
  DepartmentId,
} from '../types'
import {
  DEPARTMENTS,
  INITIAL_AGENTS,
  INITIAL_NOTIFICATIONS,
} from '../data/mockOfficeData'
import confetti from 'canvas-confetti'

/**
 * Preserved prototype simulation provider. This is not a backend state layer
 * and is intentionally not mounted by the production OFFICE shell.
 */

interface OfficeContextType {
  agents: OfficeAgent[]
  departments: Record<string, DepartmentInfo>
  tasks: OfficeTask[]
  handoffs: OfficeHandoff[]
  notifications: OfficeNotification[]
  selectedAgentId: string | null
  selectedDepartmentId: DepartmentId | null
  cameraTarget: CameraTarget
  isBrainModalOpen: boolean
  isTaskModalOpen: boolean
  isDarkTheme: boolean
  simulationSpeed: number
  apiCredits: number
  tokensBurnRate: number
  modelName: string
  activeFilter: 'all' | 'working' | 'sleeping' | 'approvals'

  // Actions
  selectAgent: (agentId: string | null) => void
  selectDepartment: (deptId: DepartmentId | null) => void
  resetCameraOverview: () => void
  focusBrain: () => void
  setBrainModalOpen: (open: boolean) => void
  setTaskModalOpen: (open: boolean) => void
  toggleTheme: () => void
  setSimulationSpeed: (speed: number) => void
  setModelName: (model: string) => void
  setActiveFilter: (
    filter: 'all' | 'working' | 'sleeping' | 'approvals',
  ) => void

  // Task & Simulation triggers
  dispatchTask: (
    title: string,
    deptId: DepartmentId,
    description?: string,
  ) => void
  simulateFullPipeline: (
    scenario: 'auth' | 'design' | 'hotfix' | 'campaign',
  ) => void
  approvePendingAction: (agentId: string, approvalId: string) => void
  rejectPendingAction: (agentId: string, approvalId: string) => void
  sendAgentMessage: (agentId: string, message: string) => void
  addNotification: (
    title: string,
    message: string,
    type?: 'info' | 'success' | 'warning' | 'alert',
    agentId?: string,
  ) => void
}

const OfficeContext = createContext<OfficeContextType | null>(null)

export const OfficeStateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [agents, setAgents] = useState<OfficeAgent[]>(() => {
    const saved = localStorage.getItem('aether_office_agents')
    return saved ? JSON.parse(saved) : INITIAL_AGENTS
  })

  const [departments] = useState<Record<string, DepartmentInfo>>(() => {
    return DEPARTMENTS
  })

  const [tasks] = useState<OfficeTask[]>([
    {
      id: 'task-101',
      title: 'WebAuthn Multi-Factor Authentication',
      description:
        'Implement FIDO2 / WebAuthn biometric passkeys with database schema migration and end-to-end tests.',
      departmentId: 'engineering',
      assignedAgentId: 'agent-auth',
      status: 'in_progress',
      progress: 81,
      priority: 'high',
      handoffChain: [
        'agent-manager',
        'agent-auth',
        'agent-database',
        'agent-qa',
      ],
      currentChainIndex: 1,
      artifacts: [
        {
          id: 'art-1',
          title: 'webauthn_passkey_handler.ts',
          type: 'code',
          content: 'export async function verifyPasskeyCredential(...) { ... }',
          createdByAgentId: 'agent-auth',
          timestamp: '10 min ago',
        },
      ],
      createdAt: '15 min ago',
    },
  ])

  const [handoffs, setHandoffs] = useState<OfficeHandoff[]>([])
  const [notifications, setNotifications] = useState<OfficeNotification[]>(
    INITIAL_NOTIFICATIONS,
  )
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedDepartmentId, setSelectedDepartmentId] =
    useState<DepartmentId | null>(null)
  const [isBrainModalOpen, setBrainModalOpen] = useState(false)
  const [isTaskModalOpen, setTaskModalOpen] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(false)
  const [simulationSpeed, setSimulationSpeed] = useState(1)
  const [apiCredits] = useState(1248.5)
  const [tokensBurnRate, setTokensBurnRate] = useState(482)
  const [modelName, setModelName] = useState('Claude 3.7 Sonnet')
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'working' | 'sleeping' | 'approvals'
  >('all')

  // Default Overview Camera position
  const [cameraTarget, setCameraTarget] = useState<CameraTarget>({
    mode: 'overview',
    targetPos: [0, 0, 0],
    cameraPos: [0, 36, 42],
    fov: 40,
  })

  // Save to local storage on changes
  useEffect(() => {
    localStorage.setItem('aether_office_agents', JSON.stringify(agents))
  }, [agents])

  // Periodic subtle background simulation loop (typing, token burning, log progression)
  useEffect(() => {
    const interval = setInterval(() => {
      setTokensBurnRate(() => {
        const workingCount = agents.filter(
          (a) => a.status === 'WORKING' || a.status === 'COLLABORATING',
        ).length
        return Math.floor(workingCount * 38 + Math.random() * 20)
      })

      setAgents((prevAgents) => {
        return prevAgents.map((agent) => {
          if (agent.status === 'WORKING' && agent.taskProgress < 100) {
            const increment = (Math.random() * 2 + 1) * simulationSpeed
            const newProgress = Math.min(
              100,
              Math.round(agent.taskProgress + increment),
            )
            return {
              ...agent,
              taskProgress: newProgress,
              stats: {
                ...agent.stats,
                tokensBurned:
                  agent.stats.tokensBurned + Math.floor(25 * simulationSpeed),
              },
            }
          }
          return agent
        })
      })
    }, 2000 / simulationSpeed)

    return () => clearInterval(interval)
  }, [simulationSpeed, agents])

  // Handoff pulse animation progress
  useEffect(() => {
    if (handoffs.length === 0) return
    const interval = setInterval(() => {
      setHandoffs((prevHandoffs) => {
        return prevHandoffs
          .map((h) => ({
            ...h,
            progress: h.progress + 0.03 * simulationSpeed,
          }))
          .filter((h) => h.progress <= 1.0)
      })
    }, 50)

    return () => clearInterval(interval)
  }, [handoffs, simulationSpeed])

  const addNotification = useCallback(
    (
      title: string,
      message: string,
      type: 'info' | 'success' | 'warning' | 'alert' = 'info',
      agentId?: string,
    ) => {
      const newNotif: OfficeNotification = {
        id: `notif-${Date.now()}-${Math.random()}`,
        title,
        message,
        type,
        agentId,
        timestamp: 'Just now',
      }
      setNotifications((prev) => [newNotif, ...prev.slice(0, 19)])
    },
    [],
  )

  // Camera Actions
  const resetCameraOverview = useCallback(() => {
    setSelectedAgentId(null)
    setSelectedDepartmentId(null)
    setCameraTarget({
      mode: 'overview',
      targetPos: [0, 0, 0],
      cameraPos: [0, 36, 42],
      fov: 40,
    })
  }, [])

  const selectDepartment = useCallback(
    (deptId: DepartmentId | null) => {
      if (!deptId) {
        resetCameraOverview()
        return
      }
      const dept = departments[deptId]
      if (!dept) return

      setSelectedDepartmentId(deptId)
      setSelectedAgentId(null)

      // Position camera facing this department pod with a pleasant isometric framing
      const [dx, dy, dz] = dept.position
      setCameraTarget({
        mode: 'department',
        targetPos: [dx, dy + 0.5, dz],
        cameraPos: [dx, dy + 16, dz + 18],
        fov: 38,
        targetEntityId: deptId,
      })
    },
    [departments, resetCameraOverview],
  )

  const selectAgent = useCallback(
    (agentId: string | null) => {
      if (!agentId) {
        setSelectedAgentId(null)
        return
      }
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return

      setSelectedAgentId(agentId)
      setSelectedDepartmentId(agent.departmentId)

      // Zoom in close to inspect the workstation, monitor and agent
      const [wx, wy, wz] = agent.workstationPos
      setCameraTarget({
        mode: 'agent',
        targetPos: [wx, wy + 0.9, wz],
        cameraPos: [wx - 1.8, wy + 2.8, wz + 3.8],
        fov: 32,
        targetEntityId: agentId,
      })
    },
    [agents],
  )

  const focusBrain = useCallback(() => {
    setSelectedAgentId(null)
    setSelectedDepartmentId(null)
    setCameraTarget({
      mode: 'brain',
      targetPos: [0, 1.2, 0],
      cameraPos: [0, 9, 11],
      fov: 35,
    })
    setBrainModalOpen(true)
  }, [])

  // Dispatch single task from prompt
  const dispatchTask = useCallback(
    (title: string, deptId: DepartmentId, description?: string) => {
      const deptAgents = agents.filter((a) => a.departmentId === deptId)
      const targetAgent =
        deptAgents.find((a) => a.status === 'SLEEPING') || deptAgents[0]
      if (!targetAgent) return

      const manager = agents.find((a) => a.role === 'Manager') || agents[0]

      // Create 3D handoff pulse from manager to target agent
      const newHandoff: OfficeHandoff = {
        id: `handoff-${Date.now()}`,
        taskId: `task-${Date.now()}`,
        fromAgentId: manager.id,
        toAgentId: targetAgent.id,
        fromPos: manager.workstationPos,
        toPos: targetAgent.workstationPos,
        progress: 0,
        label: title,
        active: true,
      }
      setHandoffs((prev) => [...prev, newHandoff])

      // Wake up target agent
      setAgents((prev) =>
        prev.map((a) => {
          if (a.id === targetAgent.id) {
            return {
              ...a,
              status: 'WORKING',
              currentTask: title,
              taskProgress: 10,
              recentLogs: [
                `Assigned new task: ${title}`,
                ...(description ? [description] : []),
                ...a.recentLogs,
              ],
            }
          }
          return a
        }),
      )

      addNotification(
        `Task Delegated to ${targetAgent.name}`,
        `Assigned: "${title}" in ${departments[deptId].name}`,
        'info',
        targetAgent.id,
      )
    },
    [agents, departments, addNotification],
  )

  // Full multi-agent pipeline simulation
  const simulateFullPipeline = useCallback(
    (scenario: 'auth' | 'design' | 'hotfix' | 'campaign') => {
      const manager = agents.find((a) => a.role === 'Manager')!

      if (scenario === 'auth') {
        const authEng = agents.find(
          (a) => a.role === 'Authentication Engineer',
        )!
        const dbEng = agents.find((a) => a.role === 'Database Engineer')!
        const qaAgent = agents.find((a) => a.role === 'QA Agent')!

        // Step 1: Manager -> Auth Engineer
        const h1: OfficeHandoff = {
          id: `h-auth-1-${Date.now()}`,
          taskId: 'auth-pipeline',
          fromAgentId: manager.id,
          toAgentId: authEng.id,
          fromPos: manager.workstationPos,
          toPos: authEng.workstationPos,
          progress: 0,
          label: 'WebAuthn Specification',
          active: true,
        }
        setHandoffs((prev) => [...prev, h1])

        setAgents((prev) =>
          prev.map((a) => {
            if (a.id === authEng.id) {
              return {
                ...a,
                status: 'WORKING',
                currentTask: 'Implementing FIDO2 WebAuthn Passkeys',
                taskProgress: 25,
                recentLogs: ['Received spec from Alexander', ...a.recentLogs],
              }
            }
            return a
          }),
        )

        addNotification(
          'Sprint Started: WebAuthn Auth',
          'Alexander delegated WebAuthn specs to Maya Lin (Auth Engineer).',
          'info',
          manager.id,
        )

        // Step 2: Auth Eng -> Database Eng
        setTimeout(() => {
          const h2: OfficeHandoff = {
            id: `h-auth-2-${Date.now()}`,
            taskId: 'auth-pipeline',
            fromAgentId: authEng.id,
            toAgentId: dbEng.id,
            fromPos: authEng.workstationPos,
            toPos: dbEng.workstationPos,
            progress: 0,
            label: 'Schema Migration',
            active: true,
          }
          setHandoffs((prev) => [...prev, h2])

          setAgents((prev) =>
            prev.map((a) => {
              if (a.id === dbEng.id) {
                return {
                  ...a,
                  status: 'WORKING',
                  currentTask: 'Adding passkey_credentials table with indexes',
                  taskProgress: 40,
                  recentLogs: [
                    'Applying SQL migration for WebAuthn tokens',
                    ...a.recentLogs,
                  ],
                }
              }
              return a
            }),
          )
          addNotification(
            'Schema Handoff',
            'Maya handed credentials schema to Siddharth (Database Engineer).',
            'info',
            authEng.id,
          )
        }, 2500)

        // Step 3: Database Eng -> QA Agent
        setTimeout(() => {
          const h3: OfficeHandoff = {
            id: `h-auth-3-${Date.now()}`,
            taskId: 'auth-pipeline',
            fromAgentId: dbEng.id,
            toAgentId: qaAgent.id,
            fromPos: dbEng.workstationPos,
            toPos: qaAgent.workstationPos,
            progress: 0,
            label: 'Run E2E Regression',
            active: true,
          }
          setHandoffs((prev) => [...prev, h3])

          setAgents((prev) =>
            prev.map((a) => {
              if (a.id === qaAgent.id) {
                return {
                  ...a,
                  status: 'WORKING',
                  currentTask: 'Executing 48 automated biometric auth tests',
                  taskProgress: 75,
                  recentLogs: [
                    'Running Playwright auth matrix tests',
                    ...a.recentLogs,
                  ],
                }
              }
              return a
            }),
          )
          addNotification(
            'QA Validation Triggered',
            'Tanya (QA Agent) started verifying authentication pipeline.',
            'info',
            qaAgent.id,
          )
        }, 5500)

        // Step 4: Completion & Celebration
        setTimeout(() => {
          addNotification(
            'Feature Ready for Production',
            'All 48 tests passed! WebAuthn Passkeys ready for deployment.',
            'success',
            manager.id,
          )
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          })
        }, 9000)
      } else if (scenario === 'hotfix') {
        const devops = agents.find((a) => a.role === 'DevOps Engineer')!
        const repair = agents.find((a) => a.role === 'Repair Agent')!

        const h: OfficeHandoff = {
          id: `h-hotfix-${Date.now()}`,
          taskId: 'hotfix',
          fromAgentId: devops.id,
          toAgentId: repair.id,
          fromPos: devops.workstationPos,
          toPos: repair.workstationPos,
          progress: 0,
          label: 'P0 Alert: Memory Leak',
          active: true,
        }
        setHandoffs((prev) => [...prev, h])

        setAgents((prev) =>
          prev.map((a) => {
            if (a.id === repair.id) {
              return {
                ...a,
                status: 'WORKING',
                currentTask:
                  'Patched camera frustum memory leak in buffer pool',
                taskProgress: 60,
                recentLogs: [
                  'Triage completed: Applied patch v3.2.1',
                  ...a.recentLogs,
                ],
              }
            }
            return a
          }),
        )

        addNotification(
          'Emergency Hotfix Deployed',
          'Darius (Repair) patched buffer allocation. All metrics green.',
          'success',
          repair.id,
        )
        confetti({ particleCount: 50, spread: 60 })
      }
    },
    [agents, addNotification],
  )

  // Approval actions (ref_frame_2.jpg)
  const approvePendingAction = useCallback(
    (agentId: string, approvalId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.pendingApproval?.id !== approvalId) return

      setAgents((prev) =>
        prev.map((a) => {
          if (a.id === agentId) {
            return {
              ...a,
              pendingApproval: null,
              recentLogs: [
                `User Approved: ${a.pendingApproval?.title || 'Action'}`,
                ...a.recentLogs,
              ],
              taskProgress: 100,
              stats: { ...a.stats, tasksCompleted: a.stats.tasksCompleted + 1 },
            }
          }
          return a
        }),
      )
      addNotification(
        'Approved by User',
        'Task unblocked and signed off. Agent proceeding with execution.',
        'success',
        agentId,
      )
      confetti({ particleCount: 60, spread: 60 })
    },
    [agents, addNotification],
  )

  const rejectPendingAction = useCallback(
    (agentId: string, approvalId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.pendingApproval?.id !== approvalId) return

      setAgents((prev) =>
        prev.map((a) => {
          if (a.id === agentId) {
            return {
              ...a,
              pendingApproval: null,
              recentLogs: [
                'User requested revision on proposal',
                ...a.recentLogs,
              ],
              taskProgress: 30,
            }
          }
          return a
        }),
      )
      addNotification(
        'Revision Requested',
        'Agent notified to rework proposal with user guidelines.',
        'warning',
        agentId,
      )
    },
    [agents, addNotification],
  )

  // Chat directly with agent
  const sendAgentMessage = useCallback(
    (agentId: string, message: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return

      // Simulate instant response from agent grounded in role
      const response = `Understood! Grounded in ${agent.role} guidelines: I will incorporate "${message}" into our current deliverable. Updating now.`

      setAgents((prev) =>
        prev.map((a) => {
          if (a.id === agentId) {
            return {
              ...a,
              status: 'WORKING',
              recentLogs: [
                `User: "${message}"`,
                `${a.name}: "${response}"`,
                ...a.recentLogs.slice(0, 8),
              ],
            }
          }
          return a
        }),
      )

      addNotification(`${agent.name} Responded`, response, 'info', agentId)
    },
    [agents, addNotification],
  )

  const toggleTheme = useCallback(() => {
    setIsDarkTheme((prev) => !prev)
  }, [])

  return (
    <OfficeContext.Provider
      value={{
        agents,
        departments,
        tasks,
        handoffs,
        notifications,
        selectedAgentId,
        selectedDepartmentId,
        cameraTarget,
        isBrainModalOpen,
        isTaskModalOpen,
        isDarkTheme,
        simulationSpeed,
        apiCredits,
        tokensBurnRate,
        modelName,
        activeFilter,
        selectAgent,
        selectDepartment,
        resetCameraOverview,
        focusBrain,
        setBrainModalOpen,
        setTaskModalOpen,
        toggleTheme,
        setSimulationSpeed,
        setModelName,
        setActiveFilter,
        dispatchTask,
        simulateFullPipeline,
        approvePendingAction,
        rejectPendingAction,
        sendAgentMessage,
        addNotification,
      }}
    >
      {children}
    </OfficeContext.Provider>
  )
}

export const useOfficeState = () => {
  const context = useContext(OfficeContext)
  if (!context) {
    throw new Error('useOfficeState must be used within an OfficeStateProvider')
  }
  return context
}
