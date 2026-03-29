import AcceptInvitePage from "@/components/site/AcceptInvitePage";

export default function InviteLandingPage({ params }: { params: { id: string } }) {
  return <AcceptInvitePage invitationId={params.id} />;
}
