import type { Project } from '../types';

export function saveProject(project: Project): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/\s+/g, '_')}_project.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadProjectFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = JSON.parse(e.target!.result as string) as Project;
        resolve(project);
      } catch {
        reject(new Error('Invalid project file'));
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
