import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import './style.css'
import App from './App.vue'
import zh from './locales/zh.json'
import en from './locales/en.json'

const i18n = createI18n({
  locale: localStorage.getItem('llmpylon_lang') || 'zh',
  fallbackLocale: 'zh',
  messages: { zh, en },
  legacy: false,
  globalInjection: true,
})

const app = createApp(App)
app.use(i18n)
app.mount('#app')
