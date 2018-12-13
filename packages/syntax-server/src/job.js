const { currentFacet, Observe, List, Set } = require("@syndicate-lang/core");

assertion type WorkItem(worker, item, result);
assertion type Job(item, result);
assertion type JobResult(output);
assertion type JobError(err);

export {
  WorkItem, Job,
  JobResult, JobError,
};

spawn named 'JobDispatcher' {
  field this.readyWorkers = Set();
  field this.runningJobs = 0;
  // dataflow {
  //   console.log(this.runningJobs, 'running jobs', this.readyWorkers.size, 'idle workers');
  // }

  on asserted Observe(Observe(WorkItem($w, _, _))) this.readyWorkers = this.readyWorkers.add(w);
  on retracted Observe(Observe(WorkItem($w, _, _))) this.readyWorkers = this.readyWorkers.remove(w);

  during Observe(Job($item, _)) {
    on start this.runningJobs++;
    on stop  this.runningJobs--;

    const waitForWorker = (retryCount) => {
      if (retryCount === 3) {
        console.error('Failed job, too many retries', item);
        react {
          assert Job(item, JobError(new Error("Too many retries")));
        }
      } else {
        react {
          const facet = currentFacet();
          dataflow {
            const worker = this.readyWorkers.first();
            if (worker !== void 0) {
              this.readyWorkers = this.readyWorkers.remove(worker);
              facet.stop(() => {
                react {
                  stop on retracted Observe(Observe(WorkItem(worker, _, _))) {
                    console.warn('Worker withdrew before answering', worker);
                    waitForWorker(retryCount + 1);
                  }
                  stop on asserted WorkItem(worker, item, $result) {
                    this.readyWorkers = this.readyWorkers.add(worker);
                    react {
                      assert Job(item, result);
                    }
                  }
                }
              });
            }
          }
        }
      }
    };

    on start waitForWorker(0);
  }
}
