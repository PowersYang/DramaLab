import ProjectClient from "@/components/project/ProjectClient";

interface StudioProjectPageProps {
  params: { id: string };
  searchParams?: { seriesId?: string };
}

export default function StudioProjectPage({ params, searchParams }: StudioProjectPageProps) {
  const breadcrumbSegments = searchParams?.seriesId
    ? [
        { label: "Projects", href: "/studio/projects" },
        { label: "Series", href: `/studio/series/${searchParams.seriesId}` },
        { label: "Episode" },
      ]
    : [
        { label: "Projects", href: "/studio/projects" },
        { label: "Project" },
      ];

  return <ProjectClient id={params.id} breadcrumbSegments={breadcrumbSegments} homeHref="/studio/projects" />;
}
