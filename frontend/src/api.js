import axios from "axios";

const configuredBackendUrl = (import.meta.env.VITE_API_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const apiBaseUrl = configuredBackendUrl.endsWith("/api")
  ? configuredBackendUrl
  : `${configuredBackendUrl}/api`;

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 12000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("edgeguard_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && localStorage.getItem("edgeguard_token")) {
      localStorage.removeItem("edgeguard_token");
      localStorage.removeItem("edgeguard_user");
      if (!window.location.pathname.startsWith("/sign-in")) window.location.assign("/sign-in");
    }
    return Promise.reject(error);
  },
);

export function apiMessage(error) {
  return error.response?.data?.error || error.message || "Something went wrong. Please try again.";
}

export default api;
