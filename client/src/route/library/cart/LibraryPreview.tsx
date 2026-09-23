import Layout from 'page/Layout';
import TabComponent from 'components/tab/TabComponent';
import { Box, Paper, Typography } from '@mui/material';
import ShoppingCart from 'components/cart/ShoppingCart';
import PageShell from 'components/PageShell';
import AssetLibrary from 'components/asset/AssetLibrary';
import { assetType, scope } from 'route/library/cart/LibraryTabDataPreview';

export function createTabs() {
  return assetType.map((tab) => ({
    label: tab.label,
    loggerContext: { library: { assetType: tab.label } },
    body: <Typography variant="body1">{tab.body}</Typography>,
  }));
}

export function createCombinedTabs() {
  return assetType.map((tab) =>
    scope.map((subtab) => ({
      label: `${subtab.label}`,
      loggerContext: {
        library: { assetType: tab.label, scope: subtab.label },
      },
      body: (
        // The panel sizes to what is in it and starts at the top of the
        // column. A fixed three hundred pixels left a blank box under a
        // heading whatever the selection held, and centred text in a panel of
        // paths made every row start somewhere different.
        <Box
          sx={{
            display: 'flex',
            gap: 4,
            alignItems: 'flex-start',
            flexDirection: { xs: 'column', md: 'row' },
          }}
        >
          <Box sx={{ flex: 2, minWidth: 0, width: '100%' }}>
            <Typography variant="body1">{subtab.body}</Typography>
            <AssetLibrary
              pathToAssets={tab.label}
              privateRepo={subtab.label === 'Private'}
            />
          </Box>
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              width: '100%',
              minWidth: { md: '20rem' },
              p: 2,
              position: { md: 'sticky' },
              top: { md: 16 },
            }}
          >
            <Typography variant="h6" component="h2">
              Selection
            </Typography>
            {/* What the panel is for. Without it the heading named a box and
                left the person to guess what filled it and where it led. */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The assets a new digital twin will be built from.
            </Typography>
            <ShoppingCart />
          </Paper>
        </Box>
      ),
    })),
  );
}

function LibraryContent() {
  const tabsData = createTabs();
  const combinedData = createCombinedTabs();

  return (
    <Layout>
      <PageShell title="Library Page">
        <TabComponent assetType={tabsData} scope={combinedData} />
      </PageShell>
    </Layout>
  );
}

export default function LibraryPreview() {
  return <LibraryContent />;
}
