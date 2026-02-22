import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUIStore } from "@/stores/ui-store";
import { ArrowLeft, Grid3X3, List, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { MediaViewMode } from "@/types/media";

interface MediaHeaderProps {
  projectId: string;
  onUploadClick: () => void;
}

export function MediaHeader({ projectId, onUploadClick }: MediaHeaderProps) {
  const { mediaViewMode, setMediaViewMode } = useUIStore();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" asChild>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
          >
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
        <h1 className="text-2xl font-semibold">Media & Files</h1>
        <p className="text-sm text-muted-foreground">
          Manage project files and attachments
        </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Tabs
          value={mediaViewMode}
          onValueChange={(v) => setMediaViewMode(v as MediaViewMode)}
        >
          <TabsList className="h-8">
            <TabsTrigger value="grid" className="px-2">
              <Grid3X3 className="size-4" />
            </TabsTrigger>
            <TabsTrigger value="table" className="px-2">
              <List className="size-4" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={onUploadClick}>
          <Upload className="size-4 mr-1" />
          Upload
        </Button>
      </div>
    </div>
  );
}
