export interface Page {
  id: string;
  pageInfo: {
    projectId: string;
    title: string;
    icon: string;
    content: string;
    order: number;
    createdById: string;
    createdByName: string;
    lastEditedById: string;
    lastEditedByName: string;
    createdAt: string;
    updatedAt: string;
  };
}
