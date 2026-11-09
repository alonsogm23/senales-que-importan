-- Clinical content is available only through the audited, authorized RPC.
-- Direct REST remains useful for scoped administrative request metadata, not clinical text.
alter policy messages_scope on public.portal_messages using(false);
revoke select on public.portal_messages from authenticated;
alter policy message_recipients_scope on public.portal_message_recipients using(false);
revoke select on public.portal_message_recipients from authenticated;
alter policy documents_scope on public.portal_documents using(false);
revoke select on public.portal_documents from authenticated;
alter policy document_recipients_scope on public.portal_document_recipients using(false);
revoke select on public.portal_document_recipients from authenticated;
alter policy observations_scope on public.portal_observations using(false);
revoke select on public.portal_observations from authenticated;
