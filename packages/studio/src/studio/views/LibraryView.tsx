import { LIBRARY } from '../../devices/registry';
import { useStudio } from '../context';

export function LibraryView() {
  const { project, setWs, toast } = useStudio();
  const cats = [...new Set(LIBRARY.map((d) => d.category))];
  return (
    <div className="fwm-lib">
      {cats.map((c) => (
        <div key={c}>
          <h3>{c}</h3>
          {LIBRARY.filter((d) => d.category === c).map((d) => (
            <div key={d.id} className={'fwm-card' + (d.available ? '' : ' is-soon')}>
              <div className="fwm-thumb" data-device={d.id}>{d.name.toUpperCase()}</div>
              <div className="fwm-card__txt">
                <b>{d.name}</b>
                <span>{d.kind}</span>
                {!d.available && <em>Coming in {d.soon}</em>}
              </div>
              {d.available && d.manifest && (
                <button type="button" className="fwm-btn-ui fwm-btn-ui--sm" aria-label={`Add ${d.name} as a new track`}
                  onClick={() => {
                    const p = d.presets?.[0];
                    const id = project.addTrack(d.manifest!, p, 0);
                    setWs({ track: id });
                    toast(`${project.track(id)?.name} added as a new track`);
                  }}>
                  Add
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      <p className="fwm-hint">Each device you add becomes its own track. Add the same device as many times as you like.</p>
    </div>
  );
}
