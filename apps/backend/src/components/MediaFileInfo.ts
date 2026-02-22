import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class MediaFileInfo extends BaseComponent {
  @CompData({ indexed: true })
  fileName: string = "";

  @CompData()
  originalFileName: string = "";

  @CompData({ indexed: true })
  mimeType: string = "";

  @CompData()
  size: number = 0;

  @CompData()
  storageKey: string = "";

  @CompData()
  url: string = "";

  @CompData({ indexed: true })
  projectId: string = "";

  @CompData({ indexed: true })
  taskId: string = "";

  @CompData({ indexed: true })
  uploadedBy: string = "";
}
