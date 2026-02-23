export type ProjectStatus = "pending" | "prospect" | "win" | "won" | "on_going" | "canceled";

export interface Project {
    id: string;
    coreRef: {
        value: string;
    };
    status: {
        value: ProjectStatus
    }
    description?: string;
    picId?: {
        value: string;
    };
    name?: {
        value: string;
    };
    parent?: {
        id: string;
    } | null;
}

export interface ProjectCore {
    id: string;
    code: string;
    name: {
        name: string;
        description: string;
    };
    clientDetail?: {
        name: {
            name: string;
            legalName: string;
        };
    } | null;
    status: string;
    winStage: string;
}

export interface CreateProjectInput {
    title: string;
    description?: string;
    picId?: string;
    status?: ProjectStatus;
}

export interface UpdateProjectInput {
    title?: string;
    description?: string;
    picId?: string | null;
    status?: ProjectStatus;
}

export interface CreateSubProjectInput {
    parentProjectId: string;
    name: string;
    description?: string;
    picId?: string;
}

export const PROJECT_STATUS_CONFIG: Record<
    ProjectStatus,
    { label: string; color: string }
> = {
    pending: { label: "Pending", color: "bg-gray-100 text-gray-700" },
    prospect: { label: "Prospect", color: "bg-amber-100 text-amber-700" },
    win: { label: "Win", color: "bg-emerald-100 text-emerald-700" },
    won: { label: "Win", color: "bg-emerald-100 text-emerald-700" },
    on_going: { label: "On Going", color: "bg-blue-100 text-blue-700" },
    canceled: { label: "Canceled", color: "bg-red-100 text-red-700" },
};