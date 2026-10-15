// EVIRMA: Reuse the widget API client, including its contact authentication header.
import { API } from 'widget/helpers/axios';

export const getContactHistory = () =>
  API.get(`/api/v1/widget/contact_history${window.location.search}`);
