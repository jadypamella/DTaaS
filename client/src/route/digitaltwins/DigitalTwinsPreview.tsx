import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { Typography } from '@mui/material';
import Layout from 'page/Layout';
import TabComponent from 'components/tab/TabComponent';
import { TabData } from 'components/tab/subcomponents/TabRender';
import AssetBoard from 'components/asset/AssetBoard';
import { defaultFiles } from 'model/backend/gitlab/digitalTwinConfig/constants';
import { addOrUpdateFile } from 'model/store/file.slice';
import tabs from 'route/digitaltwins/DigitalTwinTabDataPreview';
import PageShell from 'components/PageShell';
import CreatePage from 'route/digitaltwins/create/CreatePage';

interface DTTabProps {
  readonly newDigitalTwinName: string;
  readonly setNewDigitalTwinName: React.Dispatch<React.SetStateAction<string>>;
}

export const createDTTab = ({
  newDigitalTwinName,
  setNewDigitalTwinName,
}: DTTabProps): TabData[] =>
  tabs
    .filter(
      (tab) =>
        tab.label === 'Manage' ||
        tab.label === 'Execute' ||
        tab.label === 'Create',
    )
    .map((tab) => ({
      label: tab.label,
      loggerContext: { dt: { tab: tab.label.toLowerCase() } },
      body:
        tab.label === 'Create' ? (
          <>
            <Typography variant="body1">{tab.body}</Typography>
            <CreatePage
              newDigitalTwinName={newDigitalTwinName}
              setNewDigitalTwinName={setNewDigitalTwinName}
            />
          </>
        ) : (
          <>
            <Typography variant="body1">{tab.body}</Typography>
            <AssetBoard tab={tab.label} />
          </>
        ),
    }));

/**
 * The tabbed body of the digital twins automation preview, without the page
 * frame. The standalone route wraps this in a Layout and a PageShell, and the
 * Automation page places it beside the library preview in one of its tabs.
 */
export const DigitalTwinsAutomationPanel = () => {
  const [newDigitalTwinName, setNewDigitalTwinName] = useState('');
  const dispatch = useDispatch();

  useEffect(() => {
    defaultFiles.forEach((file) => {
      dispatch(
        addOrUpdateFile({
          name: file.name,
          content: '',
          isNew: true,
          isModified: false,
        }),
      );
    });
  }, [dispatch]);

  return (
    <TabComponent
      assetType={createDTTab({ newDigitalTwinName, setNewDigitalTwinName })}
      scope={[]}
    />
  );
};

export const DTContent = () => (
  <Layout>
    <PageShell
      title="Digital Twins Page Preview"
      description="This page demonstrates integration of DTaaS with GitLab CI/CD workflows. The feature is experimental and requires certain GitLab setup in order for it to work."
    >
      <DigitalTwinsAutomationPanel />
    </PageShell>
  </Layout>
);

export default function DigitalTwinsPreview() {
  return <DTContent />;
}
