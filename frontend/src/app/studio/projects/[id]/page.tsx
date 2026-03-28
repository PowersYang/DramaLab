import ProjectClient from "@/components/project/ProjectClient";

interface StudioProjectPageProps {
  params: { id: string };
  searchParams?: { seriesId?: string };
}

export default function StudioProjectPage({ params, searchParams }: StudioProjectPageProps) {
  const breadcrumbSegments = searchParams?.seriesId
    ? [
        { label: "项目中心", href: "/studio/projects" },
        { label: "系列", href: `/studio/series/${searchParams.seriesId}` },
        { label: "剧集" },
      ]
    : [
        { label: "项目中心", href: "/studio/projects" },
        { label: "项目" },
      ];

  return <ProjectClient id={params.id} breadcrumbSegments={breadcrumbSegments} homeHref="/studio/projects" />;
}
