import importlib.util
from pathlib import Path
from threading import Thread
import unittest
spec=importlib.util.spec_from_file_location('explorer_progress',Path(__file__).resolve().parents[1]/'progress.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class Progress(unittest.TestCase):
    def test_stages_counters_and_completion(self):
        token=p.start('job_test_1')
        try:
            p.report('Computing frames',3,10)
            self.assertEqual(p.read('job_test_1'),dict(stage='Computing frames',completed=3,total=10,status='running'))
        finally:p.finish(token)
        self.assertEqual(p.read('job_test_1')['status'],'complete')
        p.report('Outside request')
        self.assertEqual(p.read('job_test_1')['stage'],'Computing frames')
    def test_request_context_and_failure_are_isolated(self):
        token=p.start('job_main_1')
        def other():
            t=p.start('job_thread_1')
            p.report('Other thread',1,2);p.finish(t,failed=True)
        thread=Thread(target=other);thread.start();thread.join()
        p.report('Main thread');p.finish(token)
        self.assertEqual(p.read('job_main_1')['stage'],'Main thread')
        self.assertEqual(p.read('job_thread_1')['status'],'failed')
    def test_bounded_retention(self):
        for index in range(105):
            token=p.start(f'bounded_{index}');p.finish(token)
        self.assertLessEqual(len(p._records),100)
        self.assertIsNone(p.read('bounded_0'))

if __name__=='__main__':unittest.main()
