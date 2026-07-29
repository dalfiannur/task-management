// Flat FE type for the pages (wiki) domain, mapped from gen/pages_pb.

export interface Page {
  id: string;
  projectId: string;
  title: string;
  icon: string;
  content: string;
  order: number;
  createdBy: string;
  lastEditedBy: string;
  createdAt: string;
  updatedAt: string;
}
