require 'rails_helper'
require 'stringio'
require 'tmpdir'
require Rails.root.join('deploy/evirma/salebot/import').to_s
require Rails.root.join('deploy/evirma/salebot/claimed_user').to_s

# Dry run and apply on the import fixtures: the same chain as on prod, import mapping -> claimed attribute.
RSpec.describe EvirmaSalebotClaimedUser do
  let!(:account) { create(:account) }
  let(:fixtures) { Rails.root.join('deploy/evirma/salebot/fixtures') }
  let(:directory) { Dir.mktmpdir('salebot-claimed') }
  let(:mapping) { File.join(directory, 'mapping.csv') }
  let(:users) { File.join(directory, 'users.txt') }
  let(:known_user) { '0b8e1c2a-3f4d-4e5f-9a6b-7c8d9e0f1a2b' }

  before do
    stub_const('EvirmaSalebotImport::ACCOUNT_ID', account.id)
    stub_const('EvirmaSalebotClaimedUser::ACCOUNT_ID', account.id)
    create(:user, account: account, email: 'manager@example.com')
    EvirmaSalebotImport.new(clients: fixtures.join('clients.jsonl').to_s, report: fixtures.join('report.csv').to_s,
                            telegram_inbox: create(:channel_telegram, account: account).inbox.id,
                            max_inbox: create(:channel_api, account: account).inbox.id,
                            mapping_out: mapping, dry_run: false, output: StringIO.new).perform
    File.write(users, "#{known_user.upcase}\n")
  end

  after { FileUtils.remove_entry(directory) }

  def run(apply:)
    described_class.new(extra: fixtures.join('clients-extra.jsonl').to_s, mappings: [mapping], users: users,
                        apply: apply, output: StringIO.new).perform
  end

  def contact_of(client_id)
    row = CSV.read(mapping, headers: true).find { |line| line['salebot_client_id'] == client_id }
    Contact.find(row['contact_id'])
  end

  it 'reports the plan in dry-run without writing, then sets only the known claim' do
    expected = { 'set' => 1, 'skipped_unknown_user' => 1, 'skipped_bad_user_id' => 1, 'skipped_not_imported' => 1,
                 'extra_without_variables' => 1 }

    expect(run(apply: false)).to eq(expected)
    expect(contact_of('101').custom_attributes).not_to have_key('claimed_evirma_user_id')

    run(apply: true)
    expect(contact_of('101').custom_attributes['claimed_evirma_user_id']).to eq(known_user)
    expect(contact_of('101').identifier).to be_nil
    expect(run(apply: true)).to include('already_set' => 1)
  end

  it 'keeps a different existing claim' do
    contact_of('101').update!(custom_attributes: { 'claimed_evirma_user_id' => 'other' })

    expect(run(apply: true)).to include('skipped_other_claim' => 1)
    expect(contact_of('101').custom_attributes['claimed_evirma_user_id']).to eq('other')
  end
end
