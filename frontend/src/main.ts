import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import KitGallery from './ui/KitGallery.svelte';

// `?kit` shows the design system instead of the app (visual checks, TESTING.md).
const kit = new URLSearchParams(window.location.search).has('kit');

const app = mount(kit ? KitGallery : App, {
  target: document.getElementById('app')!,
});

export default app;
