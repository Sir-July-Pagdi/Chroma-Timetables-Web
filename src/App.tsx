import { Route, Routes } from 'react-router-dom'
import HomeScreen from './ui/screens/HomeScreen'
import ImportScreen from './ui/screens/ImportScreen'
import TimetableDetailScreen from './ui/screens/TimetableDetailScreen'
import ResultsScreen from './ui/screens/ResultsScreen'
import RepairWorkflowScreen from './ui/screens/RepairWorkflowScreen'
import AboutScreen from './ui/screens/AboutScreen'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/import" element={<ImportScreen />} />
      <Route path="/timetable/:runId" element={<TimetableDetailScreen />} />
      <Route path="/timetable/:runId/results" element={<ResultsScreen />} />
      <Route path="/timetable/:runId/repair" element={<RepairWorkflowScreen />} />
      <Route path="/about" element={<AboutScreen />} />
    </Routes>
  )
}
