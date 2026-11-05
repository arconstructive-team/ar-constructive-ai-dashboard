import { useEffect, useMemo, useState } from "react";
import { getFirestore } from "firebase/firestore";
import { auth } from "../auth/firebase";
import { ArtifactPane } from "./ArtifactPane";
import { createFirestoreSource } from "./firestoreSource";
import { MemoryArtifactSource, streamInto } from "./memorySource";
import { SAMPLE_REPORT_MD, sampleArtifact } from "./fixtures";
import type { ArtifactSource } from "./types";

/**
 * A stand-alone page for the artifact pane, until the project and chat
 * layout (ARCO-12) hosts it.
 *   ?artifact=demo                 streams the sample report into an in-memory source.
 *   ?project=P&artifact=A          opens a real artifact from Firestore.
 */
export function ArtifactPreview({ search = window.location.search }: { search?: string }) {
  const params = new URLSearchParams(search);
  const artifactId = params.get("artifact") ?? "demo";
  const projectId = params.get("project") ?? "";
  const demo = artifactId === "demo" || !projectId;

  const source = useMemo<ArtifactSource | null>(() => {
    if (demo) return new MemoryArtifactSource();
    return auth ? createFirestoreSource(getFirestore(auth.app)) : null;
  }, [demo]);

  const [ready, setReady] = useState(!demo);
  useEffect(() => {
    if (!demo || !(source instanceof MemoryArtifactSource)) return;
    const artifact = sampleArtifact({ status: "generating", content: "", version: 0 });
    source.put(artifact);
    setReady(true);
    return streamInto(source, { projectId: artifact.projectId, artifactId: artifact.id }, SAMPLE_REPORT_MD);
  }, [demo, source]);

  const user = auth?.currentUser;
  const editorName = user?.displayName || user?.email || "You";

  if (!source) {
    return (
      <p role="alert" className="p-6">
        Firebase is not set up for this site, so the artifact cannot load.
      </p>
    );
  }
  if (!ready) return null;

  const sample = sampleArtifact();
  return (
    <div className="h-screen">
      <ArtifactPane
        source={source}
        projectId={demo ? sample.projectId : projectId}
        artifactId={demo ? sample.id : artifactId}
        projectName={demo ? "Sample project" : params.get("projectName") || projectId}
        editorName={editorName}
      />
    </div>
  );
}
